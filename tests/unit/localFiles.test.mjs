import assert from "node:assert/strict";
import test from "node:test";

import {
  addLocalFile,
  applyLocalFileSave,
  closeLocalFile,
  createLocalFiles,
  reconnectLocalFile,
  removeLocalFile,
  selectLocalFile,
  updateLocalFileContents,
} from "../../src/localFiles.ts";

function file(name, contents, handle) {
  return { name, contents, handle };
}

test("creates one active entry with an independent saved snapshot", () => {
  const handle = { path: "/notes/one.md" };
  const source = file("one.md", "# One", handle);
  const state = createLocalFiles(source, "one");

  assert.deepEqual(state, {
    entries: [{
      id: "one",
      name: "one.md",
      contents: "# One",
      savedContents: "# One",
      handle,
      reopen: { kind: "untitled" },
      recoveryStatus: "ready",
    }],
    activeId: "one",
  });
  assert.notStrictEqual(state.entries[0], source);
  assert.strictEqual(state.entries[0].handle, handle);
});

test("appends and activates a file without changing prior state", () => {
  const firstHandle = { token: "first" };
  const initial = createLocalFiles(file("one.md", "one", firstHandle), "one");
  const next = addLocalFile(initial, file("two.md", "two", null), "two");

  assert.deepEqual(initial.entries.map((entry) => entry.id), ["one"]);
  assert.deepEqual(next.entries.map((entry) => entry.id), ["one", "two"]);
  assert.equal(next.activeId, "two");
  assert.notStrictEqual(next, initial);
  assert.notStrictEqual(next.entries, initial.entries);
  assert.strictEqual(next.entries[0], initial.entries[0]);
  assert.strictEqual(next.entries[0].handle, firstHandle);
});

test("rejects duplicate ids but permits duplicate names", () => {
  const initial = createLocalFiles(file("notes.md", "first", null), "first-id");

  assert.throws(
    () => addLocalFile(initial, file("different.md", "duplicate id", null), "first-id"),
    /Local file id already exists: first-id/,
  );

  const next = addLocalFile(initial, file("notes.md", "second", null), "second-id");
  assert.deepEqual(next.entries.map(({ id, name, contents }) => ({ id, name, contents })), [
    { id: "first-id", name: "notes.md", contents: "first" },
    { id: "second-id", name: "notes.md", contents: "second" },
  ]);
});

test("selects files while preserving independent drafts and opaque handles", () => {
  const firstHandle = { opaque: 1 };
  const secondHandle = { opaque: 2 };
  const initial = addLocalFile(
    createLocalFiles(file("same.md", "first", firstHandle), "first"),
    file("same.md", "second", secondHandle),
    "second",
  );
  const firstDraft = updateLocalFileContents(initial, "first", "first draft");
  const bothDrafts = updateLocalFileContents(firstDraft, "second", "second draft");
  const selected = selectLocalFile(bothDrafts, "first");

  assert.equal(selected.activeId, "first");
  assert.notStrictEqual(selected.entries, bothDrafts.entries);
  assert.strictEqual(selected.entries[0], bothDrafts.entries[0]);
  assert.strictEqual(selected.entries[1], bothDrafts.entries[1]);
  assert.deepEqual(selected.entries.map((entry) => entry.contents), ["first draft", "second draft"]);
  assert.strictEqual(selected.entries[0].handle, firstHandle);
  assert.strictEqual(selected.entries[1].handle, secondHandle);
  assert.strictEqual(selectLocalFile(selected, "missing"), selected);
});

test("updates only the targeted entry and preserves immutable inputs", () => {
  const first = Object.freeze({
    id: "first",
    name: "one.md",
    contents: "one",
    savedContents: "one",
    handle: null,
  });
  const second = Object.freeze({
    id: "second",
    name: "two.md",
    contents: "two",
    savedContents: "two",
    handle: null,
  });
  const entries = Object.freeze([first, second]);
  const state = Object.freeze({ entries, activeId: "first" });
  const next = updateLocalFileContents(state, "second", "two draft");

  assert.equal(next.activeId, "first");
  assert.equal(next.entries[0].contents, "one");
  assert.equal(next.entries[1].contents, "two draft");
  assert.equal(second.contents, "two");
  assert.notStrictEqual(next, state);
  assert.notStrictEqual(next.entries, entries);
  assert.strictEqual(next.entries[0], first);
  assert.notStrictEqual(next.entries[1], second);
  assert.strictEqual(updateLocalFileContents(next, "missing", "ignored"), next);
});

test("applies a save to its id without changing selection", () => {
  const oldHandle = { generation: 1 };
  const newHandle = { generation: 2 };
  const initial = addLocalFile(
    createLocalFiles(file("draft.md", "saved text", oldHandle), "first"),
    file("active.md", "active text", null),
    "second",
  );
  const drafted = updateLocalFileContents(initial, "first", "text being saved");
  const next = applyLocalFileSave(
    drafted,
    "first",
    { name: "renamed.md", handle: newHandle },
    "text being saved",
  );

  assert.equal(next.activeId, "second");
  assert.deepEqual(next.entries[0], {
    id: "first",
    name: "renamed.md",
    contents: "text being saved",
    savedContents: "text being saved",
    handle: newHandle,
    reopen: { kind: "untitled" },
    recoveryStatus: "ready",
    externalContents: undefined,
  });
  assert.strictEqual(next.entries[1], drafted.entries[1]);
  assert.strictEqual(next.entries[0].handle, newHandle);
  assert.equal(drafted.entries[0].name, "draft.md");
  assert.strictEqual(drafted.entries[0].handle, oldHandle);
});

test("preserves edits made after a save began", () => {
  const saving = updateLocalFileContents(
    createLocalFiles(file("notes.md", "old", null), "notes"),
    "notes",
    "save snapshot",
  );
  const editedAgain = updateLocalFileContents(saving, "notes", "newer draft");
  const savedHandle = { path: "/notes.md" };
  const next = applyLocalFileSave(
    editedAgain,
    "notes",
    { name: "notes.md", handle: savedHandle },
    "save snapshot",
  );

  assert.equal(next.entries[0].contents, "newer draft");
  assert.equal(next.entries[0].savedContents, "save snapshot");
  assert.strictEqual(next.entries[0].handle, savedHandle);
});

test("ignores a late save for a removed entry", () => {
  const initial = addLocalFile(
    createLocalFiles(file("one.md", "one", null), "one"),
    file("two.md", "two", null),
    "two",
  );
  const removed = removeLocalFile(initial, "one");

  assert.strictEqual(
    applyLocalFileSave(removed, "one", { name: "late.md", handle: {} }, "late"),
    removed,
  );
});

test("removing the active file selects the next entry at the same index", () => {
  let state = createLocalFiles(file("one.md", "one", null), "one");
  state = addLocalFile(state, file("two.md", "two", null), "two");
  state = addLocalFile(state, file("three.md", "three", null), "three");
  state = selectLocalFile(state, "two");

  const next = removeLocalFile(state, "two");
  assert.deepEqual(next.entries.map((entry) => entry.id), ["one", "three"]);
  assert.equal(next.activeId, "three");
  assert.strictEqual(next.entries[0], state.entries[0]);
  assert.strictEqual(next.entries[1], state.entries[2]);
});

test("removing the last active file selects the preceding entry", () => {
  const state = addLocalFile(
    createLocalFiles(file("one.md", "one", null), "one"),
    file("two.md", "two", null),
    "two",
  );

  assert.equal(removeLocalFile(state, "two").activeId, "one");
});

test("removing an inactive file preserves the active id", () => {
  const state = addLocalFile(
    createLocalFiles(file("one.md", "one", null), "one"),
    file("two.md", "two", null),
    "two",
  );
  const next = removeLocalFile(state, "one");

  assert.equal(next.activeId, "two");
  assert.deepEqual(next.entries.map((entry) => entry.id), ["two"]);
  assert.strictEqual(next.entries[0], state.entries[1]);
  assert.strictEqual(removeLocalFile(next, "missing"), next);
});

test("removing the final file returns an empty state", () => {
  const state = createLocalFiles(file("only.md", "only", null), "only");

  assert.deepEqual(removeLocalFile(state, "only"), { entries: [], activeId: null });
});

test("closing and reopening an editor preserves the same draft buffer and identity", () => {
  const drafted = updateLocalFileContents(
    createLocalFiles(file("draft.md", "saved", null), "stable-id"),
    "stable-id",
    "unsaved draft bytes",
  );
  const closed = closeLocalFile(drafted, "stable-id");

  assert.equal(closed.activeId, null);
  assert.equal(closed.entries[0].open, false);
  assert.equal(closed.entries[0].contents, "unsaved draft bytes");

  const reopened = selectLocalFile(closed, "stable-id");
  assert.equal(reopened.activeId, "stable-id");
  assert.equal(reopened.entries[0].open, true);
  assert.equal(reopened.entries[0].contents, "unsaved draft bytes");
});

test("reconnecting a relocated file updates only its physical reference", () => {
  const drafted = updateLocalFileContents(
    createLocalFiles(file("notes.md", "disk baseline", "/old/notes.md"), "stable-id", {
      kind: "desktop-path",
      path: "/old/notes.md",
    }),
    "stable-id",
    "unsaved draft bytes",
  );

  const reconnected = reconnectLocalFile(
    drafted,
    "stable-id",
    file("renamed.md", "new disk bytes", "/new/renamed.md"),
    { kind: "desktop-path", path: "/new/renamed.md" },
  );

  assert.equal(reconnected.entries[0].id, "stable-id");
  assert.equal(reconnected.entries[0].contents, "unsaved draft bytes");
  assert.equal(reconnected.entries[0].savedContents, "disk baseline");
  assert.equal(reconnected.entries[0].name, "renamed.md");
  assert.equal(reconnected.entries[0].handle, "/new/renamed.md");
  assert.deepEqual(reconnected.entries[0].reopen, {
    kind: "desktop-path",
    path: "/new/renamed.md",
  });
});


test("removing the last open editor retains closed references without selecting them", () => {
  let state = createLocalFiles(file("untitled.md", "", null), "draft");
  state = addLocalFile(state, file("notes.md", "saved", "/notes.md"), "notes");
  state = closeLocalFile(state, "notes");
  state = removeLocalFile(state, "draft");
  assert.equal(state.activeId, null);
  assert.equal(state.entries[0].open, false);
  assert.equal(selectLocalFile(state, "notes").activeId, "notes");
});

test("removing an active editor skips closed neighbors in both directions", () => {
  let state = createLocalFiles(file("a.md", "a", null), "a");
  for (const id of ["b", "c", "d"]) state = addLocalFile(state, file(id + ".md", id, null), id);
  state = closeLocalFile(state, "b");
  state = closeLocalFile(state, "c");
  assert.equal(removeLocalFile(selectLocalFile(state, "a"), "a").activeId, "d");
  assert.equal(removeLocalFile(state, "d").activeId, "a");
});
