import { expect, type Page, test } from "@playwright/test";

const fixturePath = "/tests/fixtures/file-sidebar.html";

function events(page: Page) {
  return page.getByRole("list", { name: "Callback events" }).getByRole("listitem");
}

test.describe("file sidebar", () => {
  test("invokes every action callback with stable file IDs", async ({ page }) => {
    await page.goto(fixturePath);

    await page.getByRole("button", { name: "New file" }).click();
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("button", { name: "Hide file sidebar" }).click();
    await page.getByRole("button", { name: "Select notes.md", exact: true }).first().click();
    await page.getByRole("button", { name: "Select notes.md, unsaved changes" }).click();
    await page.getByRole("button", { name: "Close notes.md" }).first().click();

    await expect(events(page)).toHaveText([
      "new",
      "open",
      "hide",
      "select:duplicate-a",
      "select:duplicate-b",
      "close:duplicate-a",
    ]);
  });

  test("closing a duplicate name does not also select it", async ({ page }) => {
    await page.goto(fixturePath);

    await page.getByRole("button", { name: "Close notes.md" }).nth(1).click();

    await expect(events(page)).toHaveText(["close:duplicate-b"]);
  });

  test("exposes active and unsaved state accessibly and visually", async ({ page }) => {
    await page.goto(fixturePath);

    const active = page.getByRole("button", { name: "Select notes.md, unsaved changes" });
    await expect(active).toHaveAttribute("aria-current", "page");
    await expect(active.locator("xpath=..")).toHaveAttribute("data-dirty", "true");
    await expect(active.locator(".fileSidebarDirtyDot")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("keeps New and Open available in the empty state", async ({ page }) => {
    await page.goto(`${fixturePath}?empty=1`);

    await expect(page.getByText("No files open")).toBeVisible();
    await expect(page.getByRole("button", { name: "New file" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open file" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Open files" }).locator("ul")).toHaveCount(0);
  });

  test("truncates long names without hiding their full accessible name", async ({ page }) => {
    await page.goto(fixturePath);
    const name = "a-very-long-markdown-filename-that-must-remain-available-to-assistive-technology.md";
    const button = page.getByRole("button", { name: `Select ${name}` });
    const label = button.locator(".fileSidebarName");

    await expect(button).toHaveAttribute("title", name);
    await expect(label).toHaveCSS("text-overflow", "ellipsis");
    expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  });

  test("all controls are native buttons in the keyboard tab order", async ({ page }) => {
    await page.goto(fixturePath);
    const controls = page.getByRole("navigation", { name: "Open files" }).getByRole("button");
    const count = await controls.count();

    await page.keyboard.press("Tab");
    for (let index = 0; index < count; index += 1) {
      await expect(controls.nth(index)).toBeFocused();
      if (index < count - 1) {
        await page.keyboard.press("Tab");
      }
    }

    await controls.first().focus();
    await page.keyboard.press("Enter");
    await controls.nth(3).focus();
    await page.keyboard.press("Space");
    await expect(events(page)).toHaveText(["new", "select:duplicate-a"]);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`uses shared palette tokens in ${theme} mode`, async ({ page }) => {
      await page.goto(`${fixturePath}?theme=${theme}`);

      const colors = await page.getByRole("navigation", { name: "Open files" }).evaluate((sidebar) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--bg-chrome)";
        document.body.append(probe);
        const tokenColor = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          sidebar: getComputedStyle(sidebar).backgroundColor,
          token: tokenColor,
          theme: document.documentElement.dataset.theme,
        };
      });

      expect(colors.theme).toBe(theme);
      expect(colors.sidebar).toBe(colors.token);
    });
  }
});
