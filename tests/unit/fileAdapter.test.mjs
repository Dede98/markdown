import assert from "node:assert/strict";
import test from "node:test";

import { fileHandlesReferToSameEntry } from "../../src/fileAdapter.ts";

test("known browser files reuse identity across distinct picker handles", async () => {
  const first = {
    token: "same-file",
    async isSameEntry(other) {
      return other?.token === this.token;
    },
  };
  const second = {
    token: "same-file",
    async isSameEntry(other) {
      return other?.token === this.token;
    },
  };

  assert.notStrictEqual(first, second);
  assert.equal(await fileHandlesReferToSameEntry(first, second), true);
  assert.equal(await fileHandlesReferToSameEntry(first, { token: "different" }), false);
  assert.equal(await fileHandlesReferToSameEntry("/one/notes.md", "/one/notes.md"), true);
  assert.equal(await fileHandlesReferToSameEntry("/one/notes.md", "/two/notes.md"), false);
});

test("revoked identity checks fail closed", async () => {
  const revoked = {
    async isSameEntry() {
      throw new DOMException("revoked", "NotAllowedError");
    },
  };
  assert.equal(await fileHandlesReferToSameEntry(revoked, {}), false);
});

test("a fresh handle can identify an entry when the stale handle throws", async () => {
  const stale = {
    async isSameEntry() {
      throw new DOMException("revoked", "NotAllowedError");
    },
  };
  const fresh = {
    async isSameEntry(other) {
      return other === stale;
    },
  };
  assert.equal(await fileHandlesReferToSameEntry(stale, fresh), true);
});
