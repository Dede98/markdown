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

  test("add comment writes inline anchors and trailing metadata", async ({ page }) => {
    await seedCommentAuthor(page, "Local User");
    await page.goto("/");
    await replaceEditorText(page, "review this phrase");

    await expect(page.getByTitle("Add comment")).toBeEnabled();
    await page.getByTitle("Add comment").click();

    const source = await getEditorSource(page);
    const match = source.match(/<!--c:([0-9A-HJKMNP-TV-Z]{26})-->review this phrase<!--\/c:\1-->/);
    expect(match).not.toBeNull();
    expect(source).toContain("markdown-comments-v1");
    expect(source).toContain(`"id":"${match?.[1]}`);
    await expect(page.getByRole("complementary", { name: "Comments" })).toBeVisible();
    await expect(page.locator(".cm-content")).not.toContainText("markdown-comments-v1");
    await expect(page.locator(".cm-commentRange")).toContainText("review this phrase");
  });

  test("comment button is disabled without a selection", async ({ page }) => {
    await page.goto("/");
    await page.locator(".cm-content").click();

    await expect(page.getByTitle("Add comment")).toBeDisabled();
  });

  test("first comment opens settings when display name is missing", async ({ page }) => {
    await page.goto("/");
    await replaceEditorText(page, "review this phrase");

    await page.getByTitle("Add comment").click();

    const settingsDialog = page.getByRole("dialog", { name: "Settings" });
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.getByRole("heading", { name: "Comments" })).toBeVisible();
    await expect(page.getByText("Set a display name before adding a comment.")).toBeVisible();
    await expect(page.getByLabel("Display name")).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Display name").fill("Dejan");
    await expect(page.getByText("Set a display name before adding a comment.")).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("markdown.comments.authorName"))).toBe("Dejan");
  });

  test("comment replies and resolved state update the metadata block", async ({ page }) => {
    await seedCommentAuthor(page, "Local User");
    await page.goto("/");
    await replaceEditorText(page, "review this phrase");
    await page.getByTitle("Add comment").click();

    await page.getByPlaceholder("Reply...").fill("First note in the thread.");
    await page.getByRole("button", { name: "Reply" }).click();
    await page.getByPlaceholder("Reply...").fill("Needs a softer verb -- and <less> jargon.");
    await page.getByRole("button", { name: "Reply" }).click();
    await page.getByLabel("Resolve thread").click();

    await expect(page.getByText("First note in the thread.")).toBeVisible();
    await expect(page.getByText("Needs a softer verb")).toBeVisible();
    await expect(page.getByText("earlier reply")).toHaveCount(0);

    const source = await getEditorSource(page);
    expect(source).toContain("\\u003cless>");
    expect(source).toContain("-\\u002d and");
    expect(source).toContain('"resolved":true');
    expect(source).toContain("Needs a softer verb");
  });

  test("comments topbar button opens the sidebar list", async ({ page }) => {
    await seedCommentAuthor(page, "Local User");
    await page.goto("/");
    await replaceEditorText(page, "review this phrase");
    await page.getByTitle("Add comment").click();
    await page.getByLabel("Close comments").click();

    await page.getByLabel("Comments").click();

    await expect(page.getByRole("complementary", { name: "Comments" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open thread" })).toBeVisible();
  });

  test("clicking a highlighted comment opens its thread", async ({ page }) => {
    await seedCommentAuthor(page, "Local User");
    await page.goto("/");
    await replaceEditorText(page, "review this phrase");
    await page.getByTitle("Add comment").click();
    await page.getByPlaceholder("Reply...").fill("Follow up here");
    await page.getByRole("button", { name: "Reply" }).click();
    await page.getByLabel("Close comments").click();

    await page.locator(".cm-commentRange").click();

    await expect(page.getByRole("complementary", { name: "Comments" })).toBeVisible();
    await expect(page.getByText("Follow up here")).toBeVisible();
    await expect(page.locator(".commentThread.isSelected")).toBeVisible();
  });

  test("raw mode exposes comment anchors and metadata", async ({ page }) => {
    await seedCommentAuthor(page, "Local User");
    await page.goto("/");
    await replaceEditorText(page, "review this phrase");
    await page.getByTitle("Add comment").click();

    await page.getByTitle(/raw markdown view/i).click();

    await expect(page.locator(".cm-content")).toContainText("<!--c:");
    await expect(page.locator(".cm-content")).toContainText("markdown-comments-v1");
    await expect(page.getByText("Raw mode exposes comment anchors")).toBeVisible();
  });

  test("unknown comment metadata version opens read-only in the sidebar", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "before\n\n<!--\nmarkdown-comments-v9\n{\"threads\":{}}\n-->");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Shift+C");

    await expect(page.getByRole("complementary", { name: "Comments" })).toBeVisible();
    await expect(page.getByText("Unsupported comments format: markdown-comments-v9")).toBeVisible();
  });

  test("broken comment anchors surface as detached threads", async ({ page }) => {
    const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    await page.goto("/");
    await setEditorText(
      page,
      `before <!--c:${id}-->detached\n\n<!--\nmarkdown-comments-v1\n{"threads":{"${id}":{"id":"${id}","createdAt":"2026-04-26T20:30:00Z","resolved":false,"replies":[]}}}\n-->`,
    );
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Shift+C");

    await expect(page.locator(".commentBadge", { hasText: "Detached" })).toBeVisible();
    await expect(page.getByText("No replies yet.")).toBeVisible();
  });

  test("detached comment threads can be re-anchored to the current selection", async ({ page }) => {
    const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    await page.goto("/");
    await setEditorText(
      page,
      `before <!--c:${id}-->detached\n\nnew target\n\n<!--\nmarkdown-comments-v1\n{"threads":{"${id}":{"id":"${id}","createdAt":"2026-04-26T20:30:00Z","resolved":false,"replies":[{"id":"r_1","author":{"name":"Local User","uuid":"local"},"ts":"2026-04-26T20:30:00Z","body":"Keep this note."}]}}}\n-->`,
    );
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Shift+C");
    await page.getByRole("button", { name: "Open thread" }).click();

    const source = await getEditorSource(page);
    const from = source.indexOf("new target");
    await setEditorSelection(page, from, from + "new target".length);
    await expect(page.getByRole("button", { name: "Re-anchor" })).toBeEnabled();
    await page.getByRole("button", { name: "Re-anchor" }).click();

    await expectEditorSource(page, `<!--c:${id}-->new target<!--/c:${id}-->`);
    await expectEditorSource(page, "Keep this note.");
    await expectEditorSourceNot(page, `before <!--c:${id}-->detached`);
    await expect(page.locator(".commentBadge", { hasText: "Detached" })).toHaveCount(0);
  });

  test("detached comment threads can be deleted without leaving metadata behind", async ({ page }) => {
    const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    await page.goto("/");
    await setEditorText(
      page,
      `before <!--c:${id}-->detached\n\n<!--\nmarkdown-comments-v1\n{"threads":{"${id}":{"id":"${id}","createdAt":"2026-04-26T20:30:00Z","resolved":false,"replies":[]}}}\n-->`,
    );
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Shift+C");
    await page.getByRole("button", { name: "Open thread" }).click();
    await page.getByRole("button", { name: "Delete" }).click();

    await expectEditorSourceNot(page, id);
    await expectEditorSourceNot(page, "markdown-comments-v1");
    await expect(page.getByText("No threads")).toBeVisible();
  });

  test("comment margin markers are visible in normal mode and hidden in quiet zen", async ({ page }) => {
    await seedCommentAuthor(page, "Local User");
    await page.goto("/");
    await replaceEditorText(page, "review this phrase");
    await page.getByTitle("Add comment").click();

    await expect(page.locator(".cm-commentMarker")).toBeVisible();
    await page.getByLabel("Close comments").click();
    await expect(page.getByRole("complementary", { name: "Comments" })).toBeHidden();
    await page.getByRole("button", { name: "Zen" }).click();

    await expect(page.locator(".cm-commentMarker")).not.toBeVisible();
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
    // Click swaps the cell into edit mode (a <textarea> takes its place) and
    // selects the existing value, so typing replaces it. End-key first
    // collapses selection to the right so `keyboard.type` appends.
    const input = firstCell.locator("textarea.cm-md-table-cell-input");
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

  test("rendered tables keep short columns readable instead of squeezing words", async ({ page }) => {
    await page.goto("/");
    await setEditorText(
      page,
      "lead\n\n| Tabelle | Zweck | Wichtigste Felder | KPI-Relevanz |\n| --- | --- | --- | --- |\n| `user` | Alle registrierten Personen | `id`, `email`, `createdAt`, `activeOrganizationId`, `onboardingCompletedAt` | Sign-up-Volumen, Onboarding-Funnel, Aktive Nutzerbasis |\n| `session` | Aktive Browser-/iOS-Sessions | `userId`, `createdAt`, `expiresAt`, `ipAddress`, `userAgent` | DAU/WAU/MAU, Geräte-Mix, Session-Dauer |\n\ntail",
    );
    await setCursorInsideText(page, "lead");

    const tableLayout = await page.locator(".cm-md-table-wrapper").evaluate((wrapper) => {
      const table = wrapper.querySelector<HTMLTableElement>(".cm-md-table");
      if (!table) {
        throw new Error("Rendered table is missing");
      }
      return {
        tableWidth: table.getBoundingClientRect().width,
        wrapperWidth: wrapper.getBoundingClientRect().width,
        columnWidths: Array.from(table.querySelectorAll("thead th"), (cell) => cell.getBoundingClientRect().width),
      };
    });
    if (tableLayout.wrapperWidth > 700) {
      expect(tableLayout.tableWidth).toBeLessThanOrEqual(tableLayout.wrapperWidth + 1);
    }
    await expect(page.locator(".cm-md-table-wrapper")).not.toHaveCSS("overflow-x", "auto");
    const [firstColumnWidth, secondColumnWidth, thirdColumnWidth, fourthColumnWidth] = tableLayout.columnWidths;
    expect(firstColumnWidth).toBeLessThan(secondColumnWidth);
    expect(firstColumnWidth).toBeLessThan(thirdColumnWidth);
    expect(firstColumnWidth).toBeLessThan(fourthColumnWidth);
    const maxColumnWidth = Math.max(...tableLayout.columnWidths);
    const minColumnWidth = Math.min(...tableLayout.columnWidths);
    expect(maxColumnWidth / minColumnWidth).toBeLessThan(2.5);

    const firstCodeBox = page.locator(".cm-md-table tbody td").first().locator("code");
    const codeBox = await firstCodeBox.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    if (tableLayout.wrapperWidth > 500) {
      expect(codeBox.width).toBeGreaterThan(codeBox.height * 1.6);
    }
  });

  test("clicking a cell mounts a wrapping text editor prefilled with the raw markdown", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(
      page,
      "lead\n\n| **bold** | plain |\n| --- | --- |\n| 1 | 2 |\n\ntail",
    );

    const headerCell = page.locator(".cm-md-table thead th").first();
    await expect(headerCell.locator("strong")).toHaveText("bold");

    await headerCell.click();
    const input = headerCell.locator("textarea.cm-md-table-cell-input");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("**bold**");
    // Rendered HTML is cleared while in edit mode.
    await expect(headerCell.locator("strong")).toHaveCount(0);
  });

  test("long table cell text edits in a wrapping textarea", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(
      page,
      "lead\n\n| A | B |\n| --- | --- |\n| short | this is a very long table cell value that should wrap while the user edits it instead of forcing a single horizontal input line |\n\ntail",
    );

    const longCell = page.locator(".cm-md-table tbody td").nth(1);
    await longCell.click();
    const input = longCell.locator("textarea.cm-md-table-cell-input");
    await expect(input).toBeFocused();
    const editorBox = await input.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        height: rect.height,
        lineHeight: Number.parseFloat(style.lineHeight),
        whiteSpace: style.whiteSpace,
      };
    });
    expect(editorBox.whiteSpace).toBe("pre-wrap");
    expect(editorBox.height).toBeGreaterThan(editorBox.lineHeight * 1.8);
  });

  test("short table cell editor uses the visible row height", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.addInitScript(() => {
      window.localStorage.setItem("markdown.contentWidth", "focused");
    });
    await page.goto("/");
    await setEditorText(
      page,
      "lead\n\n| Table | KPI |\n| --- | --- |\n| `knowledge.knowledge_document` | Document-Adoption (Uploads pro Org/Monat), Storage-Volumen (sum fileSize pro Org -> Plan-Limit-Indikator), Kategorie-Mix, Soft-Delete-Rate (isActive=false), Aktive Wissensbasis (Anzahl docs pro Org als Engagement-Proxy) |\n\ntail",
    );
    await setCursorInsideText(page, "lead");

    const shortCell = page.locator(".cm-md-table tbody td").first();
    const rowHeight = await page.locator(".cm-md-table tbody tr").first().evaluate((node) => node.getBoundingClientRect().height);
    await shortCell.click();
    const input = shortCell.locator("textarea.cm-md-table-cell-input");
    await expect(input).toBeFocused();
    const inputHeight = await input.evaluate((node) => node.getBoundingClientRect().height);

    expect(rowHeight).toBeGreaterThan(140);
    expect(inputHeight).toBeGreaterThan(rowHeight * 0.9);
  });

  test("blurring the cell textarea restores the rendered HTML view", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");
    await setEditorText(
      page,
      "lead\n\n| **bold** | plain |\n| --- | --- |\n| 1 | 2 |\n\ntail",
    );

    const headerCell = page.locator(".cm-md-table thead th").first();
    await headerCell.click();
    await expect(headerCell.locator("textarea")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(headerCell.locator("textarea")).toHaveCount(0);
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
    // from rendered output. Tree-driven fence detection
    // (`getFencedCodeContext` reads the `FencedCode` Lezer node) is
    // viewport-independent because Lezer parses the full doc, so each
    // body line resolves to "inside FencedCode" regardless of where
    // the opener sits relative to `view.visibleRanges`.
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

  test("mermaid fenced code renders as a diagram without changing markdown source", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "before\n\n```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n```\n\nafter");

    await expect(page.locator(".cm-md-mermaid")).toBeVisible();
    await expect(page.locator(".cm-md-mermaid svg")).toBeVisible();
    await expect(page.locator(".cm-md-mermaid")).toContainText("Start");
    await expect(page.locator(".cm-content")).not.toContainText("```mermaid");
    await expectEditorSource(page, "```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n```");
  });

  test("raw mode shows mermaid fence source instead of the rendered diagram", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "```mermaid\nflowchart TD\n  A --> B\n```\n\nafter");

    await expect(page.locator(".cm-md-mermaid svg")).toBeVisible();

    await page.getByRole("button", { name: "Raw" }).click();

    await expect(page.locator(".cm-md-mermaid")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText("```mermaid");
    await expect(page.locator(".cm-content")).toContainText("flowchart TD");
  });

  test("dark theme renders mermaid diagrams on a GitHub-like dark canvas", async ({ page }) => {
    await seedTheme(page, "dark");
    await page.goto("/");
    await setEditorText(page, "```mermaid\nerDiagram\n  user {\n    string id PK\n    string email UK\n    timestamp createdAt\n    boolean isActive\n    string activeOrganizationId FK\n    timestamp onboardingCompletedAt\n    string position\n    string department\n    string locationCity\n  }\n```\n\nafter");

    await expect(page.locator(".cm-md-mermaid svg")).toBeVisible();
    await expect.poll(() => page.locator(".cm-md-mermaid").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(13, 17, 23)");
    await expect.poll(() => page.locator(".cm-md-mermaid").evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(400);
  });

  test("mermaid diagram move mode supports zoom and preserves edit-on-click default", async ({ page }) => {
    await page.goto("/");
    await setEditorText(page, "```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n```\n\nafter");

    await expect(page.locator(".cm-md-mermaid svg")).toBeVisible();
    await page.getByRole("button", { name: "Enable diagram pan and zoom" }).click();
    await expect(page.getByRole("button", { name: "Edit Mermaid source" })).toBeVisible();

    const canvas = page.locator(".cm-md-mermaid-canvas");
    const before = await canvas.evaluate((node) => getComputedStyle(node).transform);
    await page.getByRole("button", { name: "Zoom diagram in" }).click();
    await expect.poll(() => canvas.evaluate((node) => getComputedStyle(node).transform)).not.toBe(before);

    await page.getByRole("button", { name: "Edit Mermaid source" }).click();
    await page.locator(".cm-md-mermaid-viewport").click();

    await expect(page.locator(".cm-md-mermaid")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText("```mermaid");
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
    await expect(page.getByRole("button", { name: "Export rendered PDF" })).toBeVisible();
  });

  test("pdf export prints the rendered view without changing markdown source", async ({ page }) => {
    await page.addInitScript(() => {
      const win = window as unknown as {
        __printCalls: number;
        __printSnapshot?: {
          appPrintExporting: boolean;
          hasRenderedTable: boolean;
          hasRawTableSource: boolean;
          title: string;
        };
      };
      win.__printCalls = 0;
      window.print = () => {
        window.dispatchEvent(new Event("beforeprint"));
        const content = document.querySelector(".cm-content")?.textContent ?? "";
        win.__printCalls += 1;
        win.__printSnapshot = {
          appPrintExporting: Boolean(document.querySelector(".appPrintExporting")),
          hasRenderedTable: Boolean(document.querySelector(".cm-md-table")),
          hasRawTableSource: content.includes("| A | B |"),
          title: document.title,
        };
        window.dispatchEvent(new Event("afterprint"));
      };
    });
    await page.goto("/");
    await setEditorText(
      page,
      "lead\n\n| A | B |\n| --- | --- |\n| **bold** | `code` |\n\ntail",
    );
    const sourceBeforeExport = await getEditorSource(page);

    await page.getByRole("button", { name: "Raw" }).click();
    await expect(page.locator(".cm-content")).toContainText("| A | B |");
    await page.getByRole("button", { name: "Export rendered PDF" }).click();

    await expect.poll(() => page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls)).toBe(1);
    const snapshot = await page.evaluate(() => (
      window as unknown as {
        __printSnapshot?: {
          appPrintExporting: boolean;
          hasRenderedTable: boolean;
          hasRawTableSource: boolean;
          title: string;
        };
      }
    ).__printSnapshot);
    expect(snapshot).toEqual({
      appPrintExporting: true,
      hasRenderedTable: true,
      hasRawTableSource: false,
      title: "untitled.pdf",
    });
    await expect.poll(() => getEditorSource(page)).toBe(sourceBeforeExport);
    await expect(page.getByRole("button", { name: "Rendered", exact: true })).toBeVisible();
  });

  test("pdf export restores the editor if afterprint does not fire", async ({ page }) => {
    await page.addInitScript(() => {
      const win = window as unknown as { __printCalls: number };
      win.__printCalls = 0;
      window.print = () => {
        win.__printCalls += 1;
        window.dispatchEvent(new Event("beforeprint"));
      };
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Export rendered PDF" }).click();

    await expect.poll(() => page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls)).toBe(1);
    await expect(page.locator(".appPrintExporting")).toHaveCount(0);
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

  test("autosave defaults off and persists its settings", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();

    const settingsDialog = page.getByRole("dialog", { name: "Settings" });
    await expect(settingsDialog.getByLabel("Autosave", { exact: true })).toHaveValue("off");
    await expect(settingsDialog.getByLabel("Autosave interval")).toBeDisabled();

    await settingsDialog.getByLabel("Autosave", { exact: true }).selectOption("interval");
    await settingsDialog.getByLabel("Autosave interval").selectOption("60");

    expect(await page.evaluate(() => window.localStorage.getItem("markdown.autosave.mode"))).toBe("interval");
    expect(await page.evaluate(() => window.localStorage.getItem("markdown.autosave.intervalSeconds"))).toBe("60");

    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" }).getByLabel("Autosave", { exact: true })).toHaveValue("interval");
    await expect(page.getByRole("dialog", { name: "Settings" }).getByLabel("Autosave interval")).toHaveValue("60");
  });

  test("autosave after edits writes existing files without prompting", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await seedAutoSave(page, "after-edit");
    await installFakeFileAdapter(page, {
      openFile: { name: "draft.md", contents: "first" },
    });
    await page.goto("/");

    await page.evaluate(() => {
      (window as unknown as { confirm: () => boolean }).confirm = () => true;
    });
    await page.getByRole("button", { name: "Open file" }).click();
    await setEditorText(page, "autosaved body");
    await expect(page.locator(".documentState")).toHaveText("Unsaved");

    await expect(page.locator(".documentState")).toHaveText("Saved", { timeout: 6000 });
    const calls = await page.evaluate(() => (window as unknown as { __fileAdapterCalls: unknown[] }).__fileAdapterCalls);
    expect(calls).toEqual([
      { kind: "open" },
      { kind: "save", name: "draft.md", contents: "autosaved body" },
    ]);
  });

  test("autosave does not open save-as for a new untitled file", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await seedAutoSave(page, "after-edit");
    await installFakeFileAdapter(page, {
      saveAsResult: { name: "autosave.md", handleId: "fs-autosave" },
    });
    await page.goto("/");

    await setEditorText(page, "needs a manual first save");

    await expect(page.locator(".documentState")).toHaveText("Unsaved");
    await page.waitForTimeout(3200);
    await expect(page.locator(".documentState")).toHaveText("Unsaved");
    const calls = await page.evaluate(() => (window as unknown as { __fileAdapterCalls: unknown[] }).__fileAdapterCalls);
    expect(calls).toEqual([]);
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

  test("content width setting supports full width and persists", async ({ page }) => {
    await page.goto("/");

    await expect.poll(() => getEditorContentMaxWidth(page)).toBe("980px");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Content width").selectOption("full");

    await expect.poll(() => getEditorContentMaxWidth(page)).toBe("none");
    expect(await page.evaluate(() => window.localStorage.getItem("markdown.contentWidth"))).toBe("full");

    await page.reload();
    await expect.poll(() => getEditorContentMaxWidth(page)).toBe("none");
  });

  test("settings show app version and web-safe update controls", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();

    const settingsDialog = page.getByRole("dialog", { name: "Settings" });
    await expect(settingsDialog.getByText("Version")).toBeVisible();
    await expect(settingsDialog.getByText("v0.0.23")).toBeVisible();
    await expect(settingsDialog.getByRole("button", { name: "Check for updates" })).toBeDisabled();
    await expect(settingsDialog.getByText("Manual update checks are available in the Mac app.")).toBeVisible();
  });

  test("zen mode hides the toolbar and keeps the document", async ({ page }, testInfo) => {
    await page.goto("/");

    // Default state: zen toggle reads "Zen Mode" and is not pressed. The
    // aria-pressed attribute mirrors the Raw toggle so screen readers can
    // announce the mode toggle the same way for both controls.
    const zenToggle = page.getByTitle("Zen Mode");
    await expect(zenToggle).toHaveAttribute("aria-pressed", "false");

    await zenToggle.click();

    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeHidden();
    await expect(page.locator(".cm-content")).toContainText("On the Quiet Hour");
    await expect(page.getByText("Zen mode")).toBeVisible();
    // After toggling on, the same button now reads "Normal Mode" and the
    // pressed state flips to true.
    await expect(page.getByTitle("Normal Mode")).toHaveAttribute("aria-pressed", "true");

    await attachScreenshot(page, testInfo, "zen-mode");
  });

  test("raw mode toggle button is visible in the topbar", async ({ page }) => {
    await page.goto("/");

    // Default state: button reads "Raw" with the FileCode icon and is not pressed.
    const toggle = page.getByRole("button", { name: "Raw" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    // Title leads with the action and ends with a parenthesised shortcut hint
    // (⌘⇧R on Mac, Ctrl+Shift+R elsewhere) — match the prefix so the
    // assertion is platform-agnostic.
    await expect(toggle).toHaveAttribute("title", /^Switch to raw markdown view \(/);
  });

  test("raw mode toggle flips label and pressed state when clicked", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Raw" }).click();

    // After click: label changes to "Rendered", aria-pressed flips to true,
    // and the title hint inverts. Title still ends with the parenthesised
    // shortcut hint, so match the prefix only.
    const toggle = page.getByRole("button", { name: "Rendered", exact: true });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("title", /^Switch to rendered view \(/);

    // Toggling again returns to the original label.
    await toggle.click();
    await expect(page.getByRole("button", { name: "Raw" })).toBeVisible();
  });

  test("raw mode reveals markdown marks that are hidden in normal mode", async ({ page }, testInfo) => {
    await page.goto("/");

    // Seed once. The Compartment-based toggle reconfigures the view in place
    // — the doc, selection, and history survive the swap, so we don't need
    // to re-seed after toggling.
    await setEditorText(page, "# Title\n\n**bold** and *soft*\n\n<!-- secret -->\n\ntail");
    await setCursorInsideText(page, "tail");

    // Normal mode hides the marks (mirrors the existing
    // "markdown syntax is hidden outside the active editing line" assertions).
    await expect(page.locator(".cm-content")).not.toContainText("**bold**");
    await expect(page.locator(".cm-content")).not.toContainText("# Title");
    await expect(page.locator(".cm-content")).not.toContainText("<!--");
    await expect(page.locator(".editorMountRaw")).toHaveCount(0);

    // Flip into raw — same doc, every byte of the source is now visible.
    await page.getByRole("button", { name: "Raw" }).click();
    await expect(page.locator(".cm-content")).toContainText("# Title");
    await expect(page.locator(".cm-content")).toContainText("**bold**");
    await expect(page.locator(".cm-content")).toContainText("*soft*");
    await expect(page.locator(".cm-content")).toContainText("<!-- secret -->");
    await expect(page.locator(".cm-content")).toContainText("tail");
    await expect(page.locator(".editorMountRaw")).toHaveCount(1);

    await attachScreenshot(page, testInfo, "raw-mode");

    // Flip back to rendered — marks hide again, "tail" still there.
    await page.getByRole("button", { name: "Rendered", exact: true }).click();
    await expect(page.locator(".cm-content")).not.toContainText("**bold**");
    await expect(page.locator(".cm-content")).not.toContainText("# Title");
    await expect(page.locator(".cm-content")).not.toContainText("<!--");
    await expect(page.locator(".cm-content")).toContainText("tail");
    await expect(page.locator(".editorMountRaw")).toHaveCount(0);
  });

  test("raw mode swaps the editor font to a monospace stack", async ({ page }) => {
    await page.goto("/");

    // Normal mode renders prose in the Charter serif stack.
    const proseFont = await page.locator(".cm-scroller").evaluate((node) => getComputedStyle(node).fontFamily);
    expect(proseFont.toLowerCase()).toContain("charter");

    await page.getByRole("button", { name: "Raw" }).click();

    // Raw mode swaps to a monospace stack (SFMono-Regular / Consolas / etc.).
    const rawFont = await page.locator(".cm-scroller").evaluate((node) => getComputedStyle(node).fontFamily);
    expect(rawFont.toLowerCase()).toMatch(/mono|consolas/);
    expect(rawFont.toLowerCase()).not.toContain("charter");
  });

  test("status bar shows line count only in raw mode", async ({ page }) => {
    await page.goto("/");

    const statusbar = page.locator(".statusbar");

    // Normal mode: chars only, no line indicator. Use a regex anchored to
    // the count word so a stray "lines" elsewhere can't sneak past.
    await expect(statusbar).toContainText(/\d+ chars/);
    await expect(statusbar).not.toContainText(/\d+ lines/);

    // Flip into raw — line count appears alongside chars. Lines comes from
    // the same `markdown` state, so it tracks edits live; the initial seeded
    // document has multiple lines so the indicator is non-zero.
    await page.getByRole("button", { name: "Raw" }).click();
    await expect(statusbar).toContainText(/\d+ lines/);
    await expect(statusbar).toContainText(/\d+ chars/);

    // Back to rendered — line indicator disappears.
    await page.getByRole("button", { name: "Rendered", exact: true }).click();
    await expect(statusbar).not.toContainText(/\d+ lines/);
    await expect(statusbar).toContainText(/\d+ chars/);
  });

  test("raw mode preference persists across reloads via localStorage", async ({ page }) => {
    await page.goto("/");

    // Enable raw mode and verify localStorage is written.
    await page.getByRole("button", { name: "Raw" }).click();
    await expect(page.getByRole("button", { name: "Rendered", exact: true })).toHaveAttribute("aria-pressed", "true");
    const stored = await page.evaluate(() => window.localStorage.getItem("markdown.raw"));
    expect(stored).toBe("1");

    // Reload — app must hydrate from storage and stay in raw mode.
    await page.reload();
    await expect(page.getByRole("button", { name: "Rendered", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rendered", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".editorMountRaw")).toHaveCount(1);
  });

  test("zen mode preference persists across reloads via localStorage", async ({ page }) => {
    await page.goto("/");

    // Enable zen mode and verify localStorage is written.
    await page.getByTitle("Zen Mode").click();
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeHidden();
    const stored = await page.evaluate(() => window.localStorage.getItem("markdown.zen"));
    expect(stored).toBe("1");

    // Reload — app must hydrate from storage and stay in zen mode.
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeHidden();
    await expect(page.getByText("Zen mode")).toBeVisible();
  });

  test("raw and zen prefs round-trip independently across reloads", async ({ page }) => {
    // The two flags are orthogonal (a user can be in raw + zen at once) and
    // must be able to flip back to false across a reload — not just stick on.
    await page.goto("/");

    // Both on.
    await page.getByRole("button", { name: "Raw" }).click();
    await page.getByTitle("Zen Mode").click();
    await expect(page.locator(".editorMountRaw")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeHidden();

    // Reload — both survive.
    await page.reload();
    await expect(page.locator(".editorMountRaw")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeHidden();
    expect(await page.evaluate(() => window.localStorage.getItem("markdown.raw"))).toBe("1");
    expect(await page.evaluate(() => window.localStorage.getItem("markdown.zen"))).toBe("1");

    // Toggle both off (zen toggle button is hidden by topbar restyle in zen
    // mode but still present — its accessible name flips to "Normal Mode").
    await page.getByTitle("Normal Mode").click();
    await page.getByRole("button", { name: "Rendered", exact: true }).click();
    await expect(page.locator(".editorMountRaw")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeVisible();

    // Reload — false also persists. A stuck-on writer would fail this.
    await page.reload();
    await expect(page.locator(".editorMountRaw")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem("markdown.raw"))).toBe("0");
    expect(await page.evaluate(() => window.localStorage.getItem("markdown.zen"))).toBe("0");
  });

  test("Mod-Shift-R toggles raw mode from anywhere in the app", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");

    // Default: not in raw mode.
    await expect(page.getByRole("button", { name: "Raw" })).toHaveAttribute("aria-pressed", "false");

    // Fire the shortcut while the editor is focused — the shortcut is wired at
    // the window level, so a CodeMirror keymap binding cannot swallow it.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Shift+R");
    await expect(page.getByRole("button", { name: "Rendered", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".editorMountRaw")).toHaveCount(1);

    // Press again — flip back.
    await page.keyboard.press("Control+Shift+R");
    await expect(page.getByRole("button", { name: "Raw" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".editorMountRaw")).toHaveCount(0);
  });

  test("Mod-R alone does not toggle raw mode (shift is required)", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    // Guards a regression where the shiftKey check is dropped: bare Mod-R is
    // the browser's reload chord and must not silently flip view state. Raw
    // toggle is bound to Mod-Shift-R only.
    await page.goto("/");

    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+R");

    // Toggle stays in default state — still labelled "Raw", not pressed.
    const toggle = page.getByRole("button", { name: "Raw" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".editorMountRaw")).toHaveCount(0);
  });

  test("Mod-. toggles zen mode from anywhere in the app", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.goto("/");

    // Default: toolbar visible (not zen).
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeVisible();

    // Fire the shortcut from inside the editor — must reach the window listener
    // before CodeMirror processes the keystroke.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+.");
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeHidden();
    await expect(page.getByText("Zen mode")).toBeVisible();

    // Press again — flip back.
    await page.keyboard.press("Control+.");
    await expect(page.getByRole("navigation", { name: "Markdown formatting" })).toBeVisible();
  });

  test("dropping a .md file onto the window opens it", async ({ page }) => {
    await page.goto("/");

    // Build a real DataTransfer with a File payload, then dispatch the drop
    // event onto body. The window-scoped capture-phase listener in App.tsx
    // intercepts before CodeMirror's own drop handler can swallow the event
    // and insert the file's bytes as text.
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      const file = new File(["# Dropped File\n\nFresh content from a drop."], "dropped.md", {
        type: "text/markdown",
      });
      dt.items.add(file);
      return dt;
    });

    await page.dispatchEvent("body", "drop", { dataTransfer });

    // Document title and editor source both update — the drop routes through
    // the same `replaceFile` funnel as the file-open dialog.
    await expect(page.locator(".documentTitle")).toContainText("dropped.md");
    await expectEditorSource(page, "# Dropped File");
    await expectEditorSource(page, "Fresh content from a drop.");
  });

  test("dropping a non-markdown file is ignored", async ({ page }) => {
    await page.goto("/");

    // The drop handler reuses `isMarkdownPath` so non-`.md` extensions are
    // silently dropped — same behaviour as the Tauri drag-drop handler.
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      const file = new File(["console.log('hi')"], "script.js", { type: "text/javascript" });
      dt.items.add(file);
      return dt;
    });

    await page.dispatchEvent("body", "drop", { dataTransfer });

    // Title still shows the seeded untitled.md and the original content remains.
    await expect(page.locator(".documentTitle")).toContainText("untitled.md");
    await expect(page.locator(".cm-content")).toContainText("On the Quiet Hour");
  });

  test("dropping a .md file while dirty prompts before replacing", async ({ page }) => {
    await page.goto("/");

    // Dirty the buffer so guardDirty triggers the confirm prompt — same path
    // taken by the file-open dialog when the user has unsaved changes.
    await setEditorText(page, "user typed this and has not saved yet");
    await expectEditorSource(page, "user typed this and has not saved yet");

    // First drop: dismiss the confirm — the dropped file is discarded and
    // the working buffer survives untouched.
    page.once("dialog", (dialog) => void dialog.dismiss());
    const firstDrop = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["# Replacement"], "incoming.md", { type: "text/markdown" }));
      return dt;
    });
    await page.dispatchEvent("body", "drop", { dataTransfer: firstDrop });
    await expect(page.locator(".documentTitle")).not.toContainText("incoming.md");
    await expectEditorSource(page, "user typed this and has not saved yet");

    // Second drop: accept the confirm — file replaces the buffer.
    page.once("dialog", (dialog) => void dialog.accept());
    const secondDrop = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["# Replacement\n\nbody"], "incoming.md", { type: "text/markdown" }));
      return dt;
    });
    await page.dispatchEvent("body", "drop", { dataTransfer: secondDrop });
    await expect(page.locator(".documentTitle")).toContainText("incoming.md");
    await expectEditorSource(page, "# Replacement");
  });

  test("dropping multiple files picks the first markdown one", async ({ page }) => {
    await page.goto("/");

    // Pile a JS, a markdown, and a txt into one DataTransfer. The handler
    // walks the list in order and stops at the first `.md` — mirrors the
    // Tauri drag-drop policy ("first match wins, rest dropped silently").
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["js noise"], "ignored.js", { type: "text/javascript" }));
      dt.items.add(new File(["# Picked\n\nThe winner."], "winner.md", { type: "text/markdown" }));
      dt.items.add(new File(["text noise"], "ignored.txt", { type: "text/plain" }));
      return dt;
    });

    await page.dispatchEvent("body", "drop", { dataTransfer });

    await expect(page.locator(".documentTitle")).toContainText("winner.md");
    await expectEditorSource(page, "# Picked");
    await expectEditorSource(page, "The winner.");
  });

  test("web build does not show the auto-update affordance", async ({ page }) => {
    await page.goto("/");

    // The auto-update path is Tauri-only — the effect short-circuits via
    // isTauriRuntime() so the web build never queries the manifest endpoint
    // and never renders the update button. Guards a regression where the
    // gate is dropped or inverted.
    await expect(page.locator(".updateButton")).toHaveCount(0);
    // Spot-check the topbar still renders the existing controls so the
    // assertion above isn't passing because the topbar failed to mount.
    await expect(page.getByRole("button", { name: "Raw" })).toBeVisible();
    await expect(page.getByTitle("Zen Mode")).toBeVisible();
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

async function getEditorContentMaxWidth(page: Page) {
  return page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".cm-content");
    if (!content) {
      throw new Error("CodeMirror content element is not available");
    }
    return getComputedStyle(content).maxWidth;
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

async function seedCommentAuthor(page: Page, name: string) {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("markdown.comments.authorName", value);
      window.localStorage.setItem("markdown.comments.authorUuid", "test-comment-author");
    } catch {
      // Storage may be unavailable; first-use prompt coverage exercises fallback.
    }
  }, name);
}

async function seedAutoSave(page: Page, mode: "off" | "after-edit" | "interval", intervalSeconds = 30) {
  await page.addInitScript(({ nextMode, nextInterval }) => {
    try {
      window.localStorage.setItem("markdown.autosave.mode", nextMode);
      window.localStorage.setItem("markdown.autosave.intervalSeconds", String(nextInterval));
    } catch {
      // Storage may be unavailable; Settings coverage exercises fallback.
    }
  }, { nextMode: mode, nextInterval: intervalSeconds });
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
