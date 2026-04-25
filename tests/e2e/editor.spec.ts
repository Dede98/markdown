import { expect, type Page, test, type TestInfo } from "@playwright/test";

test.describe("editor core", () => {
  test("loads the normal editor shell", async ({ page }, testInfo) => {
    await page.goto("/");

    await expect(page.locator(".documentTitle")).toHaveText("untitled.md");
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("On the Quiet Hour");
    await expect(page.getByText("Markdown")).toBeVisible();

    await attachScreenshot(page, testInfo, "normal-mode");
  });

  test("toolbar commands write markdown into the editor buffer", async ({ page }) => {
    await expectToolbarCommand(page, "Bold", "**bold**");
    await expectToolbarCommand(page, "Italic", "*italic*");
    await expectToolbarCommand(page, "Inline code", "`code`");
    await expectToolbarCommand(page, "Link", "[link](https://example.com)");
    await expectToolbarCommand(page, "Task list", "- [ ]");
  });

  test("block toolbar commands insert real markdown lines", async ({ page }) => {
    await page.goto("/");
    await replaceEditorText(page, "before");

    await page.getByTitle("Code block").click();
    await expectEditorSource(page, "```js\ncode\n```\n");
    await expectEditorSourceNot(page, "\\n");

    await page.getByTitle("Horizontal rule").click();
    await expectEditorSource(page, "---\n");
    await expectEditorSourceNot(page, "---\\n");
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

  test("tab key inserts a tab into the editor source", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "");

    await page.keyboard.press("Tab");
    await page.keyboard.insertText("indented");

    await expectEditorSource(page, "\tindented");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest(".cm-editor") !== null)).toBe(true);
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
    await setEditorText(page, "**bold** plain `code`");

    await setCursorInsideText(page, "plain");
    await expect(page.locator(".cm-content")).not.toContainText("**bold**");
    await expect(page.locator(".cm-content")).not.toContainText("`code`");

    await setCursorInsideText(page, "bold");
    await expect(page.locator(".cm-content")).toContainText("**bold**");

    await setCursorInsideText(page, "code");
    await expect(page.locator(".cm-content")).toContainText("`code`");
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

  test("code blocks can contain markdown-looking lines without crashing preview", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "```js\n- not a list\n**not bold**\n```\n\nafter");

    await expect(page.locator(".cm-content")).toContainText("- not a list");
    await expect(page.locator(".cm-content")).toContainText("**not bold**");
    await expect(page.locator(".cm-content")).toContainText("after");
  });

  test("code blocks highlight js syntax and horizontal rules span content width", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "```\nconst value = callThing(\"ok\", 42); // note\n() => {\n```\n\n---\n\nafter");

    await expect(page.locator(".cm-md-code-keyword")).toContainText("const");
    await expect(page.locator(".cm-md-code-function")).toContainText("callThing");
    await expect(page.locator(".cm-md-code-string")).toContainText('"ok"');
    await expect(page.locator(".cm-md-code-number")).toContainText("42");
    await expect(page.locator(".cm-md-code-comment")).toContainText("// note");
    await expect(page.locator(".cm-md-code-operator").filter({ hasText: "=>" })).toBeVisible();
    await expect.poll(() => page.locator(".cm-md-code-function").first().evaluate((node) => getComputedStyle(node).color)).not.toBe("rgb(42, 42, 46)");

    const ruleWidth = await page.locator(".cm-md-rule-widget").evaluate((node) => node.getBoundingClientRect().width);
    const ruleLineWidth = await page.locator(".cm-md-rule-widget").evaluate((node) => node.parentElement?.getBoundingClientRect().width ?? 0);
    expect(ruleWidth).toBeGreaterThan(ruleLineWidth * 0.95);
  });

  test("top chrome stays pinned while the document scrolls", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, Array.from({ length: 70 }, (_, index) => `Line ${index + 1}`).join("\n"));

    await page.locator(".cm-scroller").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      node.dispatchEvent(new Event("scroll"));
    });

    await expect(page.locator(".topbar")).toBeInViewport();
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeInViewport();
    await expect(page.locator(".topbar")).toHaveCSS("position", "sticky");
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toHaveCSS("position", "sticky");
  });

  test("enter continues an unordered list with the same marker", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "- first");

    await pressEnterInEditor(page);
    await page.keyboard.insertText("second");

    await expectEditorSource(page, "- first\n- second");
  });

  test("enter increments the next ordered list number", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "1. apple");

    await pressEnterInEditor(page);
    await page.keyboard.insertText("banana");

    await expectEditorSource(page, "1. apple\n2. banana");
  });

  test("enter continues task lists with a fresh unchecked box", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "- [x] done");

    await pressEnterInEditor(page);
    await page.keyboard.insertText("next");

    await expectEditorSource(page, "- [x] done\n- [ ] next");
  });

  test("enter on an empty list item ends the list", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "- item\n- ");

    await pressEnterInEditor(page);
    await page.keyboard.insertText("after");

    await expectEditorSource(page, "- item\n\nafter");
    await expectEditorSourceNot(page, "- item\n- \nafter");
  });

  test("enter continues a blockquote with the same prefix", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "> quoted");

    await pressEnterInEditor(page);
    await page.keyboard.insertText("more");

    await expectEditorSource(page, "> quoted\n> more");
  });

  test("enter on an empty blockquote line ends the quote", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "> quoted\n> ");

    await pressEnterInEditor(page);
    await page.keyboard.insertText("plain");

    await expectEditorSource(page, "> quoted\n\nplain");
    await expectEditorSourceNot(page, "> quoted\n> \nplain");
  });

  test("backspace at the start of a list item removes the marker", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "- item");

    await setEditorSelection(page, "- ".length);
    await page.keyboard.press("Backspace");

    await expectEditorSource(page, "item");
    await expectEditorSourceNot(page, "- item");
  });

  test("tab indents an unordered list item by two spaces", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "- top\n- nested");

    await setEditorSelection(page, "- top\n- nested".length);
    await page.keyboard.press("Tab");

    await expectEditorSource(page, "- top\n  - nested");
  });

  test("shift+tab outdents a nested list item", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "- top\n  - nested");

    await setEditorSelection(page, "- top\n  - nested".length);
    await page.keyboard.press("Shift+Tab");

    await expectEditorSource(page, "- top\n- nested");
  });

  test("enter inside a code block keeps the current indentation", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "```\n  first");

    await pressEnterInEditor(page);
    await page.keyboard.insertText("second");

    await expectEditorSource(page, "```\n  first\n  second");
  });

  test("backspace at the start of a heading removes the heading prefix", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "## Morning light");

    await setEditorSelection(page, "## ".length);
    await page.keyboard.press("Backspace");

    await expectEditorSource(page, "Morning light");
    await expectEditorSourceNot(page, "## Morning light");
  });

  test("typing an inline marker over a selection wraps the text", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "focus");

    await setEditorSelection(page, 0, "focus".length);
    await page.keyboard.insertText("*");

    await expectEditorSource(page, "*focus*");
    await expectEditorSourceNot(page, "*focu*");
  });

  test("typing a bracket over a selection wraps the text in markdown link syntax", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "site");

    await setEditorSelection(page, 0, "site".length);
    await page.keyboard.insertText("[");

    await expectEditorSource(page, "[site]");
  });

  test("mod+b shortcut bolds the current selection", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "ready");

    await setEditorSelection(page, 0, "ready".length);
    await page.keyboard.press(modKeyShortcut("b"));

    await expectEditorSource(page, "**ready**");
  });

  test("mod+i shortcut italicizes the current selection", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "soft");

    await setEditorSelection(page, 0, "soft".length);
    await page.keyboard.press(modKeyShortcut("i"));

    await expectEditorSource(page, "*soft*");
  });

  test("mod+k shortcut wraps the selection in a markdown link", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "spec");

    await setEditorSelection(page, 0, "spec".length);
    await page.keyboard.press(modKeyShortcut("k"));

    await expectEditorSource(page, "[spec](https://example.com)");
  });

  test("clicking the rendered task checkbox toggles the source between [ ] and [x]", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "- [ ] write tests\n\nafter");

    await setEditorSelection(page, "- [ ] write tests\n\nafter".length);
    await page.locator(".cm-md-task-widget").first().click();

    await expectEditorSource(page, "- [x] write tests");

    await page.locator(".cm-md-task-widget").first().click();
    await expectEditorSource(page, "- [ ] write tests");
  });

  test("pasting a url over a selection inserts a markdown link", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "spec");

    await setEditorSelection(page, 0, "spec".length);
    await pasteText(page, "https://local-first.test");

    await expectEditorSource(page, "[spec](https://local-first.test)");
  });

  test("file actions are reachable from the topbar in normal mode", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "New file" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open file" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save file" })).toBeVisible();
  });

  test("status badge tracks editor dirtiness", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installFakeFileAdapter(page);
    await page.goto("/");

    await expect(page.locator(".documentState")).toHaveText("New");

    await setEditorText(page, "# fresh");
    await expect(page.locator(".documentState")).toHaveText("Unsaved");
  });

  test("new file replaces the buffer and resets the file name", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installFakeFileAdapter(page);
    await page.goto("/");

    await setEditorText(page, "old buffer");
    await page.evaluate(() => {
      (window as unknown as { confirm: () => boolean }).confirm = () => true;
    });

    await page.getByRole("button", { name: "New file" }).click();

    await expectEditorSource(page, "");
    await expect(page.locator(".documentTitle")).toHaveText("untitled.md");
    await expect(page.locator(".documentState")).toHaveText("New");
  });

  test("open file loads adapter contents into the editor", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installFakeFileAdapter(page, {
      openFile: { name: "draft.md", contents: "# Draft\n\nfresh body" },
    });
    await page.goto("/");

    await page.evaluate(() => {
      (window as unknown as { confirm: () => boolean }).confirm = () => true;
    });
    await page.getByRole("button", { name: "Open file" }).click();

    await expectEditorSource(page, "# Draft\n\nfresh body");
    await expect(page.locator(".documentTitle")).toHaveText("draft.md");
    await expect(page.locator(".documentState")).toHaveText("Saved");
  });

  test("save file delegates to save-as when no handle exists", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installFakeFileAdapter(page, {
      saveAsResult: { name: "notes.md", handleId: "fs-1" },
    });
    await page.goto("/");

    await setEditorText(page, "draft body");
    await page.getByRole("button", { name: "Save file" }).click();

    await expect(page.locator(".documentState")).toHaveText("Saved");
    await expect(page.locator(".documentTitle")).toHaveText("notes.md");

    const calls = await page.evaluate(() => (window as unknown as { __fileAdapterCalls: unknown[] }).__fileAdapterCalls);
    expect(calls).toEqual([{ kind: "saveAs", name: "untitled.md", contents: "draft body" }]);
  });

  test("save file writes back to an existing handle without re-prompting", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installFakeFileAdapter(page, {
      openFile: { name: "draft.md", contents: "first" },
    });
    await page.goto("/");

    await page.evaluate(() => {
      (window as unknown as { confirm: () => boolean }).confirm = () => true;
    });
    await page.getByRole("button", { name: "Open file" }).click();
    await expectEditorSource(page, "first");

    await setEditorText(page, "second");
    await expect(page.locator(".documentState")).toHaveText("Unsaved");

    await page.getByRole("button", { name: "Save file" }).click();
    await expect(page.locator(".documentState")).toHaveText("Saved");

    const calls = await page.evaluate(() => (window as unknown as { __fileAdapterCalls: unknown[] }).__fileAdapterCalls);
    expect(calls).toEqual([
      { kind: "open" },
      { kind: "save", name: "draft.md", contents: "second" },
    ]);
  });

  test("mod+s shortcut triggers a save through the adapter", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installFakeFileAdapter(page, {
      saveAsResult: { name: "shortcut.md", handleId: "fs-2" },
    });
    await page.goto("/");

    await setEditorText(page, "shortcut body");
    await page.keyboard.press(modKeyShortcut("s"));

    await expect(page.locator(".documentState")).toHaveText("Saved");
    const calls = await page.evaluate(() => (window as unknown as { __fileAdapterCalls: unknown[] }).__fileAdapterCalls);
    expect(calls).toEqual([{ kind: "saveAs", name: "untitled.md", contents: "shortcut body" }]);
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

async function pressEnterInEditor(page: Page) {
  await page.keyboard.press("Enter");
}

function skipMobileKeyboardTest(testInfo: TestInfo) {
  test.skip(
    testInfo.project.name === "chrome-mobile",
    "Mobile chrome simulates a virtual keyboard; keymap-binding behavior is verified on desktop only.",
  );
}

function modKeyShortcut(letter: string) {
  return `Control+${letter.toUpperCase()}`;
}

async function pasteText(page: Page, text: string) {
  await page.evaluate((value) => {
    const target = document.querySelector<HTMLElement>(".cm-content");

    if (!target) {
      throw new Error("CodeMirror content element is not available");
    }

    target.focus();

    const data = new DataTransfer();
    data.setData("text/plain", value);

    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });

    target.dispatchEvent(event);
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

type FakeAdapterOptions = {
  openFile?: { name: string; contents: string };
  saveAsResult?: { name: string; handleId: string };
};

async function installFakeFileAdapter(page: Page, options: FakeAdapterOptions = {}) {
  await page.addInitScript((opts) => {
    type Call =
      | { kind: "new" }
      | { kind: "open" }
      | { kind: "save"; name: string; contents: string }
      | { kind: "saveAs"; name: string; contents: string };

    const win = window as unknown as {
      __fileAdapterCalls: Call[];
      __markdownFileAdapterOverride: unknown;
      confirm: () => boolean;
    };

    win.__fileAdapterCalls = [];
    const openSpec = opts.openFile;
    const saveAsSpec = opts.saveAsResult;

    win.__markdownFileAdapterOverride = {
      canSaveInPlace: () => true,
      newFile: () => {
        win.__fileAdapterCalls.push({ kind: "new" });
        return { name: "untitled.md", contents: "", handle: null };
      },
      openFile: async () => {
        win.__fileAdapterCalls.push({ kind: "open" });
        if (!openSpec) {
          return null;
        }
        return { name: openSpec.name, contents: openSpec.contents, handle: { __mock: true, name: openSpec.name } };
      },
      saveFile: async (handle: unknown, contents: string, name: string) => {
        win.__fileAdapterCalls.push({ kind: "save", name, contents });
        return { name, handle };
      },
      saveFileAs: async (name: string, contents: string) => {
        win.__fileAdapterCalls.push({ kind: "saveAs", name, contents });
        if (!saveAsSpec) {
          return { name, handle: { __mock: true, name } };
        }
        return { name: saveAsSpec.name, handle: { __mock: true, id: saveAsSpec.handleId } };
      },
    };
  }, options);
}
