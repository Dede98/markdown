import assert from "node:assert/strict";
import test from "node:test";

import { estimateReadingMinutes } from "../../src/documentStats.ts";

const words = (count) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");

test("returns zero for empty input", () => {
  assert.equal(estimateReadingMinutes(""), 0);
});

test("returns one minute for one word", () => {
  assert.equal(estimateReadingMinutes("word"), 1);
});

test("returns one minute for 200 words", () => {
  assert.equal(estimateReadingMinutes(words(200)), 1);
});

test("rounds 201 words up to two minutes", () => {
  assert.equal(estimateReadingMinutes(words(201)), 2);
});

test("returns two minutes for 400 words", () => {
  assert.equal(estimateReadingMinutes(words(400)), 2);
});

test("uses the accepted word count for mixed whitespace", () => {
  assert.equal(estimateReadingMinutes("one  two\tthree\nfour"), 1);
});
