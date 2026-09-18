import { expect, test } from "@playwright/test";

test("closing the final file leaves no unowned editor and a new file can be saved", async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as unknown as { __markdownFileAdapterOverride: unknown; __savedText?: string };
    win.__markdownFileAdapterOverride = {
      canSaveInPlace: () => true,
      newFile: () => ({ name: "untitled.md", contents: "", handle: null }),
      openFile: async () => null,
      saveFile: async () => { throw new Error("Unexpected in-place save"); },
      saveFileAs: async (_name: string, contents: string) => {
        win.__savedText = contents;
        return { name: "created.md", handle: { id: "created" } };
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Close untitled.md", exact: true }).click();
  await expect(page.locator(".editorShell .cm-content")).toHaveCount(0);
  await expect(page.locator(".documentTitle")).toHaveText("No file open");
  await expect(page.getByRole("button", { name: "Save file", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export rendered PDF", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Bold", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Create a file", exact: true }).click();
  const editor = page.locator(".editorShell .cm-content");
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.insertText("Tracked after final close");
  await expect(page.getByRole("button", { name: "Select untitled.md, unsaved changes", exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.locator(".documentTitle")).toHaveText("created.md");
  expect(await page.evaluate(() => (window as unknown as { __savedText: string }).__savedText)).toBe("Tracked after final close");
  await expect(page.getByRole("button", { name: "Select created.md", exact: true })).toBeVisible();
});
