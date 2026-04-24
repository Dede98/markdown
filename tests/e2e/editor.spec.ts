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
    await expectEditorSource(page, "**focus**");

    await page.getByTitle("Bold").click();
    await expectEditorSource(page, "focus");
    await expectEditorSourceNot(page, "****focus****");
  });

  test("link command preserves selected text and selects the inserted url", async ({ page }) => {
    await page.goto("/");
    await replaceEditorText(page, "example");

    await page.getByTitle("Link").click();
    await page.keyboard.insertText("https://local-first.test");

    await expectEditorSource(page, "[example](https://local-first.test)");
  });

  test("line commands normalize multi-line selections", async ({ page }) => {
    await page.goto("/");
    await replaceEditorText(page, "first\nsecond");

    await page.getByTitle("Bulleted list").click();
    await expectEditorSource(page, "- first");
    await expectEditorSource(page, "- second");

    await selectAllEditorText(page);
    await page.getByTitle("Numbered list").click();
    await expectEditorSource(page, "1. first");
    await expectEditorSource(page, "1. second");

    await replaceEditorText(page, "first\nsecond");
    await page.getByTitle("Blockquote").click();
    await expectEditorSource(page, "> first");
    await expectEditorSource(page, "> second");
  });

  test("heading select applies markdown heading levels", async ({ page }) => {
    await page.goto("/");

    await page.locator(".cm-content").click();
    await page.getByLabel("Heading level").selectOption("3");

    await expectEditorSource(page, "###");
  });

  test("heading commands toggle the same heading level back to paragraph", async ({ page }) => {
    await page.goto("/");
    await replaceEditorText(page, "Morning light");

    await page.getByTitle("Heading 2").click();
    await expectEditorSource(page, "## Morning light");

    await page.getByTitle("Heading 2").click();
    await expectEditorSource(page, "Morning light");
    await expectEditorSourceNot(page, "## Morning light");
  });

  test("markdown syntax is hidden outside the active editing line", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "# Quiet\n\n**bold** and *soft*\n\n- item\n\n[site](https://example.com)\n\n```js\ncallFunction();\n```\n\n---\n\ntail");

    await expect(page.locator(".cm-content")).toContainText("Quiet");
    await expect(page.locator(".cm-content")).toContainText("bold and soft");
    await expect(page.locator(".cm-content")).toContainText("item");
    await expect(page.locator(".cm-content")).toContainText("site");
    await expect(page.locator(".cm-content")).toContainText("callFunction();");
    await expect(page.locator(".cm-content")).not.toContainText("# Quiet");
    await expect(page.locator(".cm-content")).not.toContainText("**bold**");
    await expect(page.locator(".cm-content")).not.toContainText("*soft*");
    await expect(page.locator(".cm-content")).not.toContainText("- item");
    await expect(page.locator(".cm-content")).not.toContainText("[site](");
    await expect(page.locator(".cm-content")).not.toContainText("```");
    await expect(page.locator(".cm-content")).not.toContainText("---");
  });

  test("inline markdown syntax appears only when the cursor is inside that range", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "**bold** plain");

    await setCursorInsideText(page, "plain");
    await expect(page.locator(".cm-content")).not.toContainText("**bold**");

    await setCursorInsideText(page, "bold");
    await expect(page.locator(".cm-content")).toContainText("**bold**");
  });

  test("toolbar reflects the active cursor formatting", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "# Title\n\n**bold** plain\n\n[site](https://example.com)\n\n- item");

    await setCursorInsideText(page, "Title");
    await expect(page.getByLabel("Heading level")).toHaveValue("1");
    await expect(page.getByTitle("Heading 1")).toHaveAttribute("aria-pressed", "true");

    await setCursorInsideText(page, "bold");
    await expect(page.getByTitle("Bold")).toHaveAttribute("aria-pressed", "true");

    await setCursorInsideText(page, "plain");
    await expect(page.getByTitle("Bold")).toHaveAttribute("aria-pressed", "false");

    await setCursorInsideText(page, "site");
    await expect(page.getByTitle("Link")).toHaveAttribute("aria-pressed", "true");

    await setCursorInsideText(page, "item");
    await expect(page.getByTitle("Bulleted list")).toHaveAttribute("aria-pressed", "true");
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
  await expectEditorSource(page, expectedText);
}

async function replaceEditorText(page: Page, text: string) {
  await setEditorText(page, text, true);
}

async function setEditorText(page: Page, text: string, selectText = false) {
  await page.evaluate((nextText) => {
    const view = (window as unknown as { __markdownEditorView?: { focus: () => void; state: { doc: { length: number } }; dispatch: (spec: unknown) => void } }).__markdownEditorView;

    if (!view) {
      throw new Error("CodeMirror editor view is not available");
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextText },
      selection: { anchor: nextText.length, head: nextText.length },
    });
    view.focus();
  }, text);

  if (selectText) {
    await selectAllEditorText(page);
  }
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

async function setCursorInsideText(page: Page, text: string) {
  const source = await getEditorSource(page);
  const index = source.indexOf(text);

  if (index === -1) {
    throw new Error(`Text not found in editor source: ${text}`);
  }

  await setEditorSelection(page, index + Math.max(1, Math.floor(text.length / 2)));
}

async function setEditorSelection(page: Page, anchor: number, head = anchor) {
  await page.evaluate(
    ({ nextAnchor, nextHead }) => {
      const view = (window as unknown as { __markdownEditorView?: { focus: () => void; dispatch: (spec: unknown) => void } }).__markdownEditorView;

      if (!view) {
        throw new Error("CodeMirror editor view is not available");
      }

      view.dispatch({ selection: { anchor: nextAnchor, head: nextHead } });
      view.focus();
    },
    { nextAnchor: anchor, nextHead: head },
  );
}

async function expectEditorSource(page: Page, expectedText: string) {
  await expect.poll(() => getEditorSource(page)).toContain(expectedText);
}

async function expectEditorSourceNot(page: Page, expectedText: string) {
  await expect.poll(() => getEditorSource(page)).not.toContain(expectedText);
}

async function getEditorSource(page: Page) {
  return page.evaluate(() => {
    const view = (window as unknown as { __markdownEditorView?: { state: { doc: { toString: () => string } } } }).__markdownEditorView;

    if (!view) {
      throw new Error("CodeMirror editor view is not available");
    }

    return view.state.doc.toString();
  });
}
