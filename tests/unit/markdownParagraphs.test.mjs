import assert from "node:assert/strict";
import test from "node:test";

import { countMarkdownParagraphs } from "../../src/markdownText.mjs";

test("returns zero for empty input", () => {
  assert.equal(countMarkdownParagraphs(""), 0);
});

test("returns zero for whitespace-only input", () => {
  assert.equal(countMarkdownParagraphs(" \t\n\t  \n"), 0);
});

test("counts consecutive non-blank lines as one paragraph", () => {
  assert.equal(countMarkdownParagraphs("first line\nsecond line\nthird line"), 1);
});

test("counts paragraphs separated by one or more blank lines", () => {
  assert.equal(countMarkdownParagraphs("first\n\nsecond\n\n\nthird"), 3);
});

test("treats separator lines containing spaces and tabs as blank", () => {
  assert.equal(countMarkdownParagraphs("first\n \t \nsecond\n\t\nthird"), 3);
});

test("ignores leading and trailing blank lines", () => {
  assert.equal(countMarkdownParagraphs("\n \t\nfirst\nsecond\n\t\n"), 1);
});

test("counts paragraphs with CRLF line endings", () => {
  assert.equal(countMarkdownParagraphs("first\r\nline\r\n\r\nsecond\r\n"), 2);
});

test("counts paragraphs with lone carriage-return line endings", () => {
  assert.equal(countMarkdownParagraphs("first\rline\r\rsecond\r"), 2);
});
