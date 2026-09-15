import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMarkdownLineEndings } from "../../src/markdownText.mjs";

test("keeps empty input empty", () => {
  assert.equal(normalizeMarkdownLineEndings(""), "");
});

test("preserves LF-only input exactly", () => {
  const source = "# Heading\n\n  indented text  \n";

  assert.equal(normalizeMarkdownLineEndings(source), source);
});

test("normalizes CRLF line endings to LF", () => {
  assert.equal(
    normalizeMarkdownLineEndings("first line\r\nsecond line\r\n"),
    "first line\nsecond line\n",
  );
});

test("normalizes lone carriage returns to LF", () => {
  assert.equal(
    normalizeMarkdownLineEndings("first line\rsecond line\r"),
    "first line\nsecond line\n",
  );
});

test("normalizes mixed line endings while preserving all other content", () => {
  const source = "  # Title  \r\n\rParagraph\n\t- item  \rfinal line";
  const expected = "  # Title  \n\nParagraph\n\t- item  \nfinal line";

  assert.equal(normalizeMarkdownLineEndings(source), expected);
});
