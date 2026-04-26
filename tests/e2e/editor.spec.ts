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

  test("html comments are hidden in preview both single-line and multi-line", async ({ page }) => {
    await page.goto("/");
    await setEditorText(
      page,
      "before\n\n<!-- single -->\n\n<!--\nmulti\nline\n-->\n\nafter",
    );
    await setCursorInsideText(page, "before");

    // Off-cursor comments must not surface in the rendered surface.
    await expect(page.locator(".cm-content")).toContainText("before");
    await expect(page.locator(".cm-content")).toContainText("after");
    await expect(page.locator(".cm-content")).not.toContainText("<!--");
    await expect(page.locator(".cm-content")).not.toContainText("-->");
    await expect(page.locator(".cm-content")).not.toContainText("single");
    await expect(page.locator(".cm-content")).not.toContainText("multi");
    await expect(page.locator(".cm-content")).not.toContainText("line");
  });

  test("html comments stay hidden even when the cursor lands on the comment offset", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "before\n\n<!-- secret -->\n\nafter");

    // Block-level replace makes the position uneditable, but we still try to
    // park the selection at the comment line — comments must remain hidden
    // regardless. A future "raw markdown" mode will expose them for editing.
    await setCursorInsideText(page, "secret");
    await expect(page.locator(".cm-content")).not.toContainText("<!--");
    await expect(page.locator(".cm-content")).not.toContainText("secret");
  });

  test("fully-comment lines collapse so no empty placeholder line remains", async ({ page }) => {
    await page.goto("/");
    // Source has 5 lines (`before`, blank, comment, blank, `after`). With the
    // block-level replace the comment line should drop out of the rendered
    // line count entirely.
    await setEditorText(page, "before\n\n<!-- gone -->\n\nafter");
    await setCursorInsideText(page, "before");

    const renderedLines = await page.locator(".cm-line").count();
    expect(renderedLines).toBeLessThan(5);
  });

  test("underline toolbar wraps selection in <u>...</u> and renders with underline", async ({ page }) => {
    await page.goto("/");
    await replaceEditorText(page, "underscore");

    await page.getByTitle("Underline").click();
    await expectEditorSource(page, "<u>underscore</u>");
  });

  test("underline tags hide off-cursor and surface back on-cursor", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "before <u>here</u> tail");

    await setCursorInsideText(page, "before");
    await expect(page.locator(".cm-content")).toContainText("here");
    await expect(page.locator(".cm-content")).not.toContainText("<u>");
    await expect(page.locator(".cm-content")).not.toContainText("</u>");
    await expect(page.locator(".cm-md-underline")).toContainText("here");

    await setCursorInsideText(page, "here");
    await expect(page.locator(".cm-content")).toContainText("<u>here</u>");
  });

  test("underline button reflects active cursor formatting", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(page, "<u>line</u> plain");

    await setCursorInsideText(page, "line");
    await expect(page.getByTitle("Underline")).toHaveAttribute("aria-pressed", "true");

    await setCursorInsideText(page, "plain");
    await expect(page.getByTitle("Underline")).toHaveAttribute("aria-pressed", "false");
  });

  test("gfm tables render as a real <table> widget when the cursor is outside the block", async ({ page }) => {
    await page.goto("/");
    await setEditorText(
      page,
      "lead paragraph\n\n| Col A | Col B | Col C |\n| ----- | :---: | ----: |\n| 1     | 2     | 3     |\n| 4     | 5     | 6     |\n\ntail paragraph",
    );
    await setCursorInsideText(page, "lead");

    // Widget shape: real <table>, header row + 2 body rows.
    await expect(page.locator(".cm-md-table")).toHaveCount(1);
    await expect(page.locator(".cm-md-table thead tr")).toHaveCount(1);
    await expect(page.locator(".cm-md-table tbody tr")).toHaveCount(2);
    await expect(page.locator(".cm-md-table thead th").nth(0)).toHaveText("Col A");
    await expect(page.locator(".cm-md-table tbody tr").nth(0).locator("td").nth(2)).toHaveText("3");

    // Alignments: separator was `| --- | :---: | ----: |`.
    await expect(page.locator(".cm-md-table thead th").nth(1)).toHaveCSS("text-align", "center");
    await expect(page.locator(".cm-md-table thead th").nth(2)).toHaveCSS("text-align", "right");

    // Critical regression check: content downstream of the block must still
    // render. The previous reverted attempt broke decorations everywhere
    // after the table because the block-level replace overlapped per-line
    // decorations on the same lines.
    await expect(page.locator(".cm-content")).toContainText("lead paragraph");
    await expect(page.locator(".cm-content")).toContainText("tail paragraph");
  });

  test("table widget keeps rendering even when the cursor is parked at the block offset", async ({ page }) => {
    await page.goto("/");
    await setEditorText(
      page,
      "before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter",
    );

    // Park the cursor on the header line. Block widgets are not directly
    // editable; the previous cursor-driven source toggle caused jarring
    // layout shifts on every arrow keypress, so the widget now stays
    // rendered regardless of where the selection lands.
    await setCursorInsideText(page, "| A | B |");
    await expect(page.locator(".cm-md-table")).toHaveCount(1);
  });

  test("clicking the rendered table widget keeps the widget visible", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(
      page,
      "before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter",
    );
    await setCursorInsideText(page, "before");
    await expect(page.locator(".cm-md-table")).toHaveCount(1);

    // Clicking the widget positions the cursor at the block edge but the
    // The widget itself stays mounted; clicking just routes the cursor for
    // CodeMirror, the cell remains editable in place.
    await page.locator(".cm-md-table").click();
    await expect(page.locator(".cm-md-table")).toHaveCount(1);
  });

  test("clicking a line below a rendered table positions the caret on that exact line", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    // Three distinct lines after the table so any one-line drift is
    // visible in the assertion. The earlier bug rendered the widget root
    // as a bare <table> with `margin: 0.6em 0`; CM6's height map measured
    // `getBoundingClientRect().height` (margin-excluded), so clicks below
    // the table mapped to the next source line down.
    await setEditorText(
      page,
      "intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nfirst-after\nsecond-after\nthird-after\n",
    );
    await expect(page.locator(".cm-md-table")).toHaveCount(1);

    await page.locator(".cm-line").filter({ hasText: "second-after" }).click();

    const headLineText = await page.evaluate(() => {
      const view = (
        window as unknown as {
          __markdownEditorView?: {
            state: {
              selection: { main: { head: number } };
              doc: { lineAt: (pos: number) => { text: string } };
            };
          };
        }
      ).__markdownEditorView;
      if (!view) {
        throw new Error("CodeMirror editor view is not available");
      }
      return view.state.doc.lineAt(view.state.selection.main.head).text;
    });
    expect(headLineText).toBe("second-after");
  });

  test("typing in a rendered table cell writes back to the markdown source", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(
      page,
      "before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter",
    );

    const firstCell = page.locator(".cm-md-table tbody tr").first().locator("td").first();
    await firstCell.click();
    // Click swaps the cell into edit mode (an <input> takes its place) and
    // selects the existing value, so typing replaces it. End-key first
    // collapses selection to the right so `keyboard.type` appends.
    const input = firstCell.locator("input.cm-md-table-cell-input");
    await expect(input).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type("X");

    await expectEditorSource(page, "| 1X | 2 |");
    await expect(page.locator(".cm-md-table")).toHaveCount(1);
    await expect(input).toHaveValue("1X");
  });

  test("rendered table cells display inline markdown formatting when not focused", async ({ page }) => {
    await page.goto("/");
    await setEditorText(
      page,
      "lead\n\n| **bold** | *italic* | ~~strike~~ |\n| --- | --- | --- |\n| `code` | <u>under</u> | plain |\n\ntail",
    );
    await setCursorInsideText(page, "lead");

    await expect(page.locator(".cm-md-table thead th").nth(0).locator("strong")).toHaveText("bold");
    await expect(page.locator(".cm-md-table thead th").nth(1).locator("em")).toHaveText("italic");
    await expect(page.locator(".cm-md-table thead th").nth(2).locator(".cm-md-strike")).toHaveText("strike");
    await expect(page.locator(".cm-md-table tbody td").nth(0).locator("code")).toHaveText("code");
    await expect(page.locator(".cm-md-table tbody td").nth(1).locator(".cm-md-underline")).toHaveText("under");

    await expect(page.locator(".cm-md-table thead")).not.toContainText("**");
    await expect(page.locator(".cm-md-table thead")).not.toContainText("~~");
    await expect(page.locator(".cm-md-table tbody")).not.toContainText("<u>");
  });

  test("clicking a cell mounts a text input prefilled with the raw markdown", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(
      page,
      "lead\n\n| **bold** | plain |\n| --- | --- |\n| 1 | 2 |\n\ntail",
    );

    const headerCell = page.locator(".cm-md-table thead th").first();
    await expect(headerCell.locator("strong")).toHaveText("bold");

    await headerCell.click();
    const input = headerCell.locator("input.cm-md-table-cell-input");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("**bold**");
    // Rendered HTML is cleared while in edit mode.
    await expect(headerCell.locator("strong")).toHaveCount(0);
  });

  test("blurring the cell input restores the rendered HTML view", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(
      page,
      "lead\n\n| **bold** | plain |\n| --- | --- |\n| 1 | 2 |\n\ntail",
    );

    const headerCell = page.locator(".cm-md-table thead th").first();
    await headerCell.click();
    await expect(headerCell.locator("input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(headerCell.locator("input")).toHaveCount(0);
    await expect(headerCell.locator("strong")).toHaveText("bold");
  });

  test("a non-table line that just happens to start with a pipe does not become a widget", async ({ page }) => {
    await page.goto("/");
    // No separator line below the pipe row -> not a real GFM table.
    await setEditorText(page, "| just one row |\n\nafter");
    await setCursorInsideText(page, "after");

    await expect(page.locator(".cm-md-table")).toHaveCount(0);
  });

  test("inline html comments hide their span without crashing the surrounding line", async ({ page }) => {
    await page.goto("/");
    // The link inside the comment is the canonical reproducer for the
    // overlapping-replace failure: the link off-cursor branch wants to replace
    // the URL span, which sits inside the already-replaced comment range.
    await setEditorText(page, "lead <!-- [a](https://example.com) --> tail\n\nelsewhere");
    await setCursorInsideText(page, "elsewhere");

    await expect(page.locator(".cm-content")).toContainText("lead");
    await expect(page.locator(".cm-content")).toContainText("tail");
    await expect(page.locator(".cm-content")).not.toContainText("<!--");
    await expect(page.locator(".cm-content")).not.toContainText("https://example.com");
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

  test("fence body stays styled as code after the opening ``` scrolls out of view", async ({ page }) => {
    await page.goto("/");
    // The fence opener sits near the top of a long doc. Once the user
    // scrolls past it, only the fence body is in the viewport. The
    // earlier ViewPlugin reset `inCodeFence = false` on every visible-
    // range rebuild, so the body got re-tokenized as plain prose: the
    // inline bold/italic regexes fired and the `**` markers disappeared
    // from rendered output. The full-doc `lineContextField` precompute
    // makes the visible loop seed `inCodeFence` from the precomputed
    // line context so the body remains code regardless of scroll.
    const fenceBody = Array.from({ length: 80 }, (_, index) => `**not bold ${index + 1}**`).join("\n");
    const trailing = Array.from({ length: 60 }, (_, index) => `tail ${index + 1}`).join("\n");
    await setEditorText(page, `intro\n\n\`\`\`\n${fenceBody}\n\`\`\`\n\n${trailing}\n`);

    // Scroll the editor's content so the opening ``` sits above the
    // visible viewport. The mid-body fence lines remain on screen.
    await page.locator(".cm-scroller").evaluate((node) => {
      const target = Math.max(0, node.scrollHeight / 2 - node.clientHeight / 2);
      node.scrollTop = target;
      node.dispatchEvent(new Event("scroll"));
    });

    // The fence body lines must keep the code-line class even though
    // the opening fence is no longer in `view.visibleRanges`.
    const visibleFenceLine = page
      .locator(".cm-md-code-line")
      .filter({ hasText: "not bold" })
      .first();
    await expect(visibleFenceLine).toBeVisible();
    // No inline-bold decoration should have leaked onto a fence line.
    await expect(visibleFenceLine.locator(".cm-md-bold")).toHaveCount(0);
    // Raw `**` should still be rendered (not collapsed into a styled run).
    await expect(visibleFenceLine).toContainText("**not bold");
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

  test("mod+s captures the latest typed characters when the shortcut races a pending render", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installFakeFileAdapter(page, {
      saveAsResult: { name: "typed.md", handleId: "fs-typed" },
    });
    await page.goto("/");

    // Drive text through the real keyboard path so `setMarkdown` is queued via
    // CodeMirror's onChange. Mod+S immediately afterwards must read the latest
    // value via the ref instead of a stale closure.
    await setEditorText(page, "");
    await page.keyboard.insertText("racy body");
    await page.keyboard.press(modKeyShortcut("s"));

    await expect(page.locator(".documentState")).toHaveText("Saved");
    const calls = await page.evaluate(() => (window as unknown as { __fileAdapterCalls: unknown[] }).__fileAdapterCalls);
    expect(calls).toEqual([{ kind: "saveAs", name: "untitled.md", contents: "racy body" }]);
  });

  test("theme toggle cycles light, dark, and system and reflects the choice on <html>", async ({ page }) => {
    await seedTheme(page, "light");
    await page.goto("/");

    const toggle = page.getByRole("button", { name: /theme/i });
    await expect(toggle).toHaveAccessibleName(/light theme/i);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await toggle.click();
    await expect(toggle).toHaveAccessibleName(/dark theme/i);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await toggle.click();
    // System resolves to either light or dark; both are acceptable, but the
    // label must indicate "System" so the user can tell what they picked.
    await expect(toggle).toHaveAccessibleName(/system theme/i);
    const resolvedUnderSystem = await page.locator("html").getAttribute("data-theme");
    expect(["light", "dark"]).toContain(resolvedUnderSystem);

    await toggle.click();
    await expect(toggle).toHaveAccessibleName(/light theme/i);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("theme preference persists across reloads via localStorage", async ({ page }) => {
    // Start from a known light state, then click once to land on "dark" no matter
    // what the OS prefers. We avoid `seedTheme` here because `addInitScript`
    // would re-seed on reload and overwrite the value the user just chose.
    await page.goto("/");
    await page.evaluate(() => window.localStorage.setItem("markdown.theme", "light"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: /theme/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const stored = await page.evaluate(() => window.localStorage.getItem("markdown.theme"));
    expect(stored).toBe("dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: /theme/i })).toHaveAccessibleName(/dark theme/i);
  });

  test("pre-paint bootstrap applies the stored theme before React mounts", async ({ page }) => {
    await seedTheme(page, "dark");
    await page.goto("/");

    // The inline script in index.html runs before the React app, so the
    // attribute must already be set by the time the topbar appears.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: /theme/i })).toHaveAccessibleName(/dark theme/i);
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

async function seedTheme(page: Page, pref: "light" | "dark" | "system") {
  // Stamp the pref into localStorage before navigation so the pre-paint script
  // in index.html resolves the same way the user would on a real reload.
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("markdown.theme", value);
    } catch {
      // Storage may be unavailable; tests will still exercise default-system path.
    }
  }, pref);
}

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
