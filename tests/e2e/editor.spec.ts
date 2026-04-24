import { expect, type Page, test, type TestInfo } from "@playwright/test";

test.describe("editor core", () => {
  test("loads the normal editor shell", async ({ page }, testInfo) => {
    await page.goto("/");

    await expect(page.locator(".documentTitle")).toHaveText("on-the-quiet-hour.md");
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("On the Quiet Hour");
    await expect(page.getByText("Markdown")).toBeVisible();

    await attachScreenshot(page, testInfo, "normal-mode");
  });

  test("toolbar commands write markdown into the editor buffer", async ({ page }) => {
    await expectToolbarCommand(page, "Bold", "**bold**");
    await expectToolbarCommand(page, "Italic", "*italic*");
    await expectToolbarCommand(page, "Link", "[link](https://example.com)");
    await expectToolbarCommand(page, "Task list", "- [ ]");
  });

  test("inline toolbar commands toggle selected text without nesting", async ({ page }) => {
    await page.goto("/");
    await replaceEditorText(page, "focus");

    await page.getByTitle("Bold").click();
    await expect(page.locator(".cm-content")).toContainText("**focus**");

    await page.getByTitle("Bold").click();
    await expect(page.locator(".cm-content")).toContainText("focus");
    await expect(page.locator(".cm-content")).not.toContainText("****focus****");
  });

  test("link command preserves selected text and selects the inserted url", async ({ page }) => {
    await page.goto("/");
    await replaceEditorText(page, "example");

    await page.getByTitle("Link").click();
    await page.keyboard.insertText("https://local-first.test");

    await expect(page.locator(".cm-content")).toContainText("[example](https://local-first.test)");
  });

  test("line commands normalize multi-line selections", async ({ page }) => {
    await page.goto("/");
    await replaceEditorText(page, "first\nsecond");

    await page.getByTitle("Bulleted list").click();
    await expect(page.locator(".cm-content")).toContainText("- first");
    await expect(page.locator(".cm-content")).toContainText("- second");

    await selectAllEditorText(page);
    await page.getByTitle("Numbered list").click();
    await expect(page.locator(".cm-content")).toContainText("1. first");
    await expect(page.locator(".cm-content")).toContainText("1. second");

    await replaceEditorText(page, "first\nsecond");
    await page.getByTitle("Blockquote").click();
    await expect(page.locator(".cm-content")).toContainText("> first");
    await expect(page.locator(".cm-content")).toContainText("> second");
  });

  test("heading select applies markdown heading levels", async ({ page }) => {
    await page.goto("/");

    await page.locator(".cm-content").click();
    await page.getByLabel("Heading level").selectOption("3");

    await expect(page.locator(".cm-content")).toContainText("###");
  });

  test("heading commands toggle the same heading level back to paragraph", async ({ page }) => {
    await page.goto("/");
    await replaceEditorText(page, "Morning light");

    await page.getByTitle("Heading 2").click();
    await expect(page.locator(".cm-content")).toContainText("## Morning light");

    await page.getByTitle("Heading 2").click();
    await expect(page.locator(".cm-content")).toContainText("Morning light");
    await expect(page.locator(".cm-content")).not.toContainText("## Morning light");
  });

  test("zen mode hides the toolbar and keeps the document", async ({ page }, testInfo) => {
    await page.goto("/");

    await page.getByTitle("Zen Mode").click();

    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeHidden();
    await expect(page.locator(".cm-content")).toContainText("On the Quiet Hour");
    await expect(page.getByText("Zen mode")).toBeVisible();

    await attachScreenshot(page, testInfo, "zen-mode");
  });
});

test("mobile layout keeps editor and mode toggle usable", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.locator(".cm-content")).toContainText("On the Quiet Hour");
  await expect(page.getByTitle("Zen Mode")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeVisible();

  await attachScreenshot(page, testInfo, "mobile-normal-mode");
});

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
}

async function expectToolbarCommand(page: Page, title: string, expectedText: string) {
  await page.goto("/");
  await page.locator(".cm-content").click();
  await page.getByTitle(title).click();
  await expect(page.locator(".cm-content")).toContainText(expectedText);
}

async function replaceEditorText(page: Page, text: string) {
  await page.evaluate((nextText) => {
    const view = (window as unknown as { __markdownEditorView?: { focus: () => void; state: { doc: { length: number } }; dispatch: (spec: unknown) => void } }).__markdownEditorView;

    if (!view) {
      throw new Error("CodeMirror editor view is not available");
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextText },
      selection: { anchor: 0, head: nextText.length },
    });
    view.focus();
  }, text);
}

async function selectAllEditorText(page: Page) {
  await page.evaluate(() => {
    const view = (window as unknown as { __markdownEditorView?: { focus: () => void; state: { doc: { length: number } }; dispatch: (spec: unknown) => void } }).__markdownEditorView;

    if (!view) {
      throw new Error("CodeMirror editor view is not available");
    }

    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.focus();
  });
}
