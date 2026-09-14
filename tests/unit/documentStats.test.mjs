import assert from "node:assert/strict";
import test from "node:test";

import { countDocumentWords } from "../../src/documentStats.ts";

test("returns zero for empty and whitespace-only source", () => {
  assert.equal(countDocumentWords(""), 0);
  assert.equal(countDocumentWords(" \t\n\r\n\u00a0"), 0);
});

test("counts tokens separated by mixed JavaScript whitespace", () => {
  assert.equal(countDocumentWords("one two\tthree\nfour\u00a0five"), 5);
});

test("counts tokens separated by CRLF", () => {
  assert.equal(countDocumentWords("first\r\nsecond\r\nthird"), 3);
});

test("counts Unicode text as whitespace-delimited tokens", () => {
  assert.equal(countDocumentWords("こんにちは 世界 café"), 3);
});

test("counts raw Markdown syntax literally", () => {
  assert.equal(countDocumentWords("# Hello\n\nworld"), 3);
  assert.equal(countDocumentWords("**bold** [link](https://example.com) ---"), 3);
});

test("does not change the source", () => {
  const source = "  # Hello\r\n\r\nworld  ";

  countDocumentWords(source);

  assert.equal(source, "  # Hello\r\n\r\nworld  ");
});
