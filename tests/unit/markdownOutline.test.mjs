import assert from "node:assert/strict";
import test from "node:test";

import {
  createMarkdownOutline,
  extractMarkdownHeadings,
} from "../../src/markdownOutline.mjs";

test("returns multiple headings in source order with their levels", () => {
  assert.deepEqual(
    extractMarkdownHeadings("## Second\ntext\n# First\n#### Fourth"),
    [
      { level: 2, text: "Second" },
      { level: 1, text: "First" },
      { level: 4, text: "Fourth" },
    ],
  );
});

test("handles LF, CRLF, and lone-CR line endings", () => {
  assert.deepEqual(
    extractMarkdownHeadings("# LF\n## Next"),
    [
      { level: 1, text: "LF" },
      { level: 2, text: "Next" },
    ],
  );
  assert.deepEqual(
    extractMarkdownHeadings("# Title\r\n## Section ##\ntext"),
    [
      { level: 1, text: "Title" },
      { level: 2, text: "Section" },
    ],
  );
  assert.deepEqual(
    extractMarkdownHeadings("# First\r### Third\r"),
    [
      { level: 1, text: "First" },
      { level: 3, text: "Third" },
    ],
  );
});

test("accepts heading levels one through six and rejects seven hashes", () => {
  assert.deepEqual(
    extractMarkdownHeadings(
      "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n####### Seven",
    ),
    [
      { level: 1, text: "One" },
      { level: 2, text: "Two" },
      { level: 3, text: "Three" },
      { level: 4, text: "Four" },
      { level: 5, text: "Five" },
      { level: 6, text: "Six" },
    ],
  );
});

test("requires a space or tab after the opening hashes", () => {
  assert.deepEqual(
    extractMarkdownHeadings("#No space\n##\n###\tTabbed\n#### Spaced"),
    [
      { level: 3, text: "Tabbed" },
      { level: 4, text: "Spaced" },
    ],
  );
});

test("accepts zero to three leading spaces but rejects other indentation", () => {
  assert.deepEqual(
    extractMarkdownHeadings(
      "# Zero\n # One\n  ## Two\n   ### Three\n    #### Four\n\t##### Tab",
    ),
    [
      { level: 1, text: "Zero" },
      { level: 1, text: "One" },
      { level: 2, text: "Two" },
      { level: 3, text: "Three" },
    ],
  );
});

test("trims heading whitespace and omits headings with empty text", () => {
  assert.deepEqual(
    extractMarkdownHeadings("#   Title \t \n## \t\n### ###\n#### Content"),
    [
      { level: 1, text: "Title" },
      { level: 4, text: "Content" },
    ],
  );
});

test("removes separated closing hashes and retains unseparated hashes", () => {
  assert.deepEqual(
    extractMarkdownHeadings(
      "# Removed ###\n## Literal###\n### Also literal# #\n#### Trimmed ##   ",
    ),
    [
      { level: 1, text: "Removed" },
      { level: 2, text: "Literal###" },
      { level: 3, text: "Also literal#" },
      { level: 4, text: "Trimmed" },
    ],
  );
});

test("preserves inline Markdown markup verbatim", () => {
  assert.deepEqual(
    extractMarkdownHeadings(
      "# *Emphasis* and **strong**\n## [Link](https://example.com) with `code` & text",
    ),
    [
      { level: 1, text: "*Emphasis* and **strong**" },
      {
        level: 2,
        text: "[Link](https://example.com) with `code` & text",
      },
    ],
  );
});

test("ignores setext headings", () => {
  assert.deepEqual(extractMarkdownHeadings("Title\n=====\nSubtitle\n-----"), []);
});

test("ignores headings in backtick and tilde fences", () => {
  const source = [
    "```js",
    "# Hidden backtick",
    "```",
    "# Visible one",
    "~~~ text",
    "## Hidden tilde",
    "~~~",
    "## Visible two",
  ].join("\n");

  assert.deepEqual(extractMarkdownHeadings(source), [
    { level: 1, text: "Visible one" },
    { level: 2, text: "Visible two" },
  ]);
});

test("requires a matching, sufficiently long, otherwise empty fence closer", () => {
  const source = [
    "````language",
    "# Hidden one",
    "~~~",
    "## Hidden two",
    "```",
    "### Hidden three",
    "```` trailing",
    "#### Hidden four",
    "    ````",
    "##### Hidden five",
    "   ````` \t",
    "###### Visible",
  ].join("\n");

  assert.deepEqual(extractMarkdownHeadings(source), [
    { level: 6, text: "Visible" },
  ]);
});

test("an unclosed fence hides the remainder of the document", () => {
  assert.deepEqual(
    extractMarkdownHeadings("# Visible\n~~~md\n## Hidden\n### Also hidden"),
    [{ level: 1, text: "Visible" }],
  );
});

test("creates normalized ASCII IDs for headings", () => {
  assert.deepEqual(
    createMarkdownOutline(
      "# Hello, World!\n## Multiple   separators___together\n### --Edge punctuation--",
    ),
    [
      { level: 1, text: "Hello, World!", id: "hello-world" },
      {
        level: 2,
        text: "Multiple   separators___together",
        id: "multiple-separators-together",
      },
      { level: 3, text: "--Edge punctuation--", id: "edge-punctuation" },
    ],
  );
});

test("uses section when heading text has no ASCII letters or digits", () => {
  assert.deepEqual(createMarkdownOutline("# !!!\n## café 🎉"), [
    { level: 1, text: "!!!", id: "section" },
    { level: 2, text: "café 🎉", id: "caf" },
  ]);
});

test("adds incrementing suffixes to repeated heading IDs", () => {
  assert.deepEqual(createMarkdownOutline("# Repeat\n## Repeat\n### Repeat"), [
    { level: 1, text: "Repeat", id: "repeat" },
    { level: 2, text: "Repeat", id: "repeat-2" },
    { level: 3, text: "Repeat", id: "repeat-3" },
  ]);
});

test("avoids collisions with naturally suffixed headings", () => {
  assert.deepEqual(
    createMarkdownOutline("# Same\n## Same\n# Same-2\n# !!!\n# !!!").map(
      ({ id }) => id,
    ),
    ["same", "same-2", "same-2-2", "section", "section-2"],
  );
});

test("keeps generated IDs independent between calls", () => {
  const source = "# Same\n## Same";

  assert.deepEqual(createMarkdownOutline(source), createMarkdownOutline(source));
  assert.equal(createMarkdownOutline(source)[0].id, "same");
});

test("preserves extracted heading levels, text, and source order", () => {
  assert.deepEqual(
    createMarkdownOutline("text\n### Third *marked*\n# First\n## Second"),
    [
      { level: 3, text: "Third *marked*", id: "third-marked" },
      { level: 1, text: "First", id: "first" },
      { level: 2, text: "Second", id: "second" },
    ],
  );
});
