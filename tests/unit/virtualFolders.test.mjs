import assert from "node:assert/strict";
import test from "node:test";

import {
  addFileReference,
  assignFile,
  closeEditingSession,
  createFolder,
  createVirtualFolderState,
  deserializeVirtualFolderState,
  editingSessionId,
  fileId,
  folderId,
  migrateFlatFileCollection,
  openEditingSession,
  orderedFiles,
  orderedFolders,
  removeFileReference,
  removeFolder,
  renameFolder,
  serializeVirtualFolderState,
  setEditingSessionDirty,
  setFolderCollapsed,
  unassignFile,
  updateFileReference,
} from "../../src/virtualFolders.ts";

const fid = fileId;
const gid = folderId;
const sid = editingSessionId;

function succeed(result) {
  assert.equal(result.ok, true, result.ok ? undefined : result.error.message);
  return result.state;
}

function withFile(state, id, displayName = "notes.md") {
  return succeed(addFileReference(state, { id: fid(id), displayName }));
}

function withFolder(state, id, name) {
  return succeed(createFolder(state, { id: gid(id), name }));
}

test("creates, validates, renames, and rejects normalized folder-name conflicts", () => {
  const empty = createVirtualFolderState();
  const projects = withFolder(empty, "projects", " Projects ");
  assert.equal(projects.folders[0].name, "Projects");

  for (const name of ["", "  \n "]) {
    const result = createFolder(projects, { id: gid(`blank-${name.length}`), name });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid-name");
    assert.strictEqual(result.state, projects);
  }
  const duplicate = createFolder(projects, { id: gid("other"), name: " projects " });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, "duplicate-folder-name");

  const archive = withFolder(projects, "archive", "Archive");
  const renamed = succeed(renameFolder(archive, gid("archive"), " Reference "));
  assert.equal(renamed.folders[1].name, "Reference");
  const conflict = renameFolder(renamed, gid("archive"), "PROJECTS");
  assert.equal(conflict.ok, false);
  assert.strictEqual(conflict.state, renamed);
});

test("persists collapse and expand transitions while excluding runtime sessions", () => {
  let state = withFolder(createVirtualFolderState(), "work", "Work");
  state = withFile(state, "file", "work.md");
  state = succeed(openEditingSession(state, { id: sid("editor"), fileId: fid("file") }));
  state = succeed(setFolderCollapsed(state, gid("work"), true));
  const serialized = serializeVirtualFolderState(state);
  assert.equal(serialized.folders[0].collapsed, true);
  assert.equal("sessions" in serialized, false);

  const decoded = deserializeVirtualFolderState(serialized);
  assert.deepEqual(decoded.issues, []);
  assert.equal(decoded.state.folders[0].collapsed, true);
  assert.deepEqual(decoded.state.sessions, []);
  assert.equal(succeed(setFolderCollapsed(decoded.state, gid("work"), false)).folders[0].collapsed, false);
});

test("assigns, atomically moves, unassigns, and reassigns after folder removal", () => {
  let state = withFile(createVirtualFolderState(), "note");
  state = withFolder(state, "one", "One");
  state = withFolder(state, "two", "Two");
  state = succeed(assignFile(state, fid("note"), gid("one")));
  assert.equal(state.memberships.note, "one");
  state = succeed(assignFile(state, fid("note"), gid("two")));
  assert.equal(state.memberships.note, "two");
  state = succeed(unassignFile(state, fid("note")));
  assert.deepEqual(orderedFiles(state, null).map((file) => file.id), ["note"]);
  state = succeed(assignFile(state, fid("note"), gid("one")));
  state = succeed(removeFolder(state, gid("one")));
  assert.equal(state.memberships.note, null);
  assert.equal(state.files.length, 1);
  state = succeed(assignFile(state, fid("note"), gid("two")));
  assert.equal(state.memberships.note, "two");
});

test("folder removal preserves clean and dirty remembered files and their sessions", () => {
  let state = withFolder(createVirtualFolderState(), "drafts", "Drafts");
  state = withFile(state, "clean", "clean.md");
  state = withFile(state, "dirty", "dirty.md");
  state = succeed(assignFile(state, fid("clean"), gid("drafts")));
  state = succeed(assignFile(state, fid("dirty"), gid("drafts")));
  state = succeed(openEditingSession(state, { id: sid("clean-editor"), fileId: fid("clean") }));
  state = succeed(openEditingSession(state, { id: sid("dirty-editor"), fileId: fid("dirty"), dirty: true }));

  const removed = succeed(removeFolder(state, gid("drafts")));
  assert.deepEqual(orderedFiles(removed, null).map((file) => file.id), ["clean", "dirty"]);
  assert.deepEqual(removed.sessions.map(({ id, dirty }) => ({ id, dirty })), [
    { id: "clean-editor", dirty: false },
    { id: "dirty-editor", dirty: true },
  ]);
});

test("duplicate basenames remain distinct through memberships and a round trip", () => {
  let state = withFolder(createVirtualFolderState(), "left-folder", "Left");
  state = withFolder(state, "right-folder", "Right");
  state = withFile(state, "left-file", "notes.md");
  state = withFile(state, "right-file", "notes.md");
  state = succeed(assignFile(state, fid("left-file"), gid("left-folder")));
  state = succeed(assignFile(state, fid("right-file"), gid("right-folder")));
  const decoded = deserializeVirtualFolderState(serializeVirtualFolderState(state)).state;
  assert.deepEqual(orderedFiles(decoded, gid("left-folder")).map((file) => file.id), ["left-file"]);
  assert.deepEqual(orderedFiles(decoded, gid("right-folder")).map((file) => file.id), ["right-file"]);
});

test("closing a session leaves the reference and remembered membership intact", () => {
  let state = withFolder(createVirtualFolderState(), "work", "Work");
  state = withFile(state, "note");
  state = succeed(assignFile(state, fid("note"), gid("work")));
  state = succeed(openEditingSession(state, { id: sid("editor"), fileId: fid("note"), dirty: true }));
  state = succeed(closeEditingSession(state, sid("editor")));
  assert.deepEqual(state.sessions, []);
  assert.equal(state.files[0].id, "note");
  assert.equal(state.memberships.note, "work");
});

test("remembered-reference and session lifecycle operations stay independent", () => {
  let state = withFile(createVirtualFolderState(), "note");
  state = succeed(openEditingSession(state, { id: sid("editor"), fileId: fid("note"), dirty: true }));
  state = succeed(updateFileReference(state, fid("note"), { displayName: "renamed.md" }));
  state = succeed(setEditingSessionDirty(state, sid("editor"), false));
  state = succeed(removeFileReference(state, fid("note")));
  assert.deepEqual(state.files, []);
  assert.deepEqual(state.sessions, [{ id: "editor", fileId: "note", dirty: false }]);
});

test("unknown IDs fail explicitly without changing unrelated state", () => {
  let state = withFolder(createVirtualFolderState(), "known-folder", "Known");
  state = withFile(state, "known-file");
  for (const result of [
    assignFile(state, fid("missing"), gid("known-folder")),
    assignFile(state, fid("known-file"), gid("missing")),
    unassignFile(state, fid("missing")),
    removeFolder(state, gid("missing")),
    closeEditingSession(state, sid("missing")),
  ]) {
    assert.equal(result.ok, false);
    assert.strictEqual(result.state, state);
  }
});

test("malformed data reports issues, preserves unrelated records, and ungroups dangling membership", () => {
  const decoded = deserializeVirtualFolderState({
    schema: "markdown-virtual-folders",
    version: 1,
    folders: [
      { id: "valid-folder", name: "Work", order: "bad", collapsed: true },
      { id: "duplicate-name", name: " work ", order: 1, collapsed: false },
      { id: "broken-folder", name: "", order: 2, collapsed: false },
    ],
    files: [
      { id: "kept", displayName: "notes.md", order: 2 },
      { id: "other", displayName: "other.md", order: 0 },
      { id: "kept", displayName: "duplicate.md", order: 1 },
      { id: "broken", displayName: "", order: 3 },
    ],
    memberships: [
      { fileId: "kept", folderId: "missing-folder" },
      { fileId: "other", folderId: "valid-folder" },
      { fileId: "other", folderId: null },
      { fileId: "missing-file", folderId: "valid-folder" },
      { nope: true },
    ],
  });
  assert.deepEqual(decoded.state.files.map((file) => file.id), ["other", "kept"]);
  assert.equal(decoded.state.memberships.kept, null);
  assert.equal(decoded.state.memberships.other, "valid-folder");
  assert.ok(decoded.issues.some((issue) => issue.code === "invalid-order"));
  assert.ok(decoded.issues.some((issue) => issue.code === "duplicate-folder"));
  assert.ok(decoded.issues.some((issue) => issue.code === "duplicate-file"));
  assert.ok(decoded.issues.some((issue) => issue.code === "dangling-folder"));
  assert.ok(decoded.issues.some((issue) => issue.code === "dangling-file"));
  assert.ok(decoded.issues.some((issue) => issue.code === "duplicate-membership"));
  assert.ok(decoded.issues.some((issue) => issue.code === "invalid-membership"));
});

test("canonical ordering is deterministic across ties, transitions, and repeated round trips", () => {
  const decoded = deserializeVirtualFolderState({
    schema: "markdown-virtual-folders",
    version: 1,
    folders: [
      { id: "z", name: "Zed", order: 5, collapsed: false },
      { id: "a", name: "Alpha", order: 5, collapsed: false },
    ],
    files: [
      { id: "z-file", displayName: "z.md", order: 3 },
      { id: "a-file", displayName: "a.md", order: 3 },
    ],
    memberships: [
      { fileId: "z-file", folderId: null },
      { fileId: "a-file", folderId: null },
    ],
  });
  assert.deepEqual(orderedFolders(decoded.state).map((folder) => folder.id), ["a", "z"]);
  assert.deepEqual(orderedFiles(decoded.state, null).map((file) => file.id), ["a-file", "z-file"]);
  const first = serializeVirtualFolderState(decoded.state);
  const second = serializeVirtualFolderState(deserializeVirtualFolderState(first).state);
  assert.deepEqual(second, first);
});

test("migrates flat collections safely, deterministically, and idempotently", () => {
  const legacy = {
    files: [
      { id: "supplied", displayName: "notes.md", reopen: { kind: "desktop-path", path: "/a/notes.md" } },
      { displayName: "notes.md", reopen: { kind: "desktop-path", path: "/b/notes.md" } },
      { displayName: "notes.md", reopen: { kind: "desktop-path", path: "/c/notes.md" } },
      { id: "supplied", displayName: "copy.md", reopen: { kind: "untitled" } },
      { id: "missing-name" },
      null,
    ],
  };
  const first = migrateFlatFileCollection(legacy);
  const repeated = migrateFlatFileCollection(legacy);
  assert.deepEqual(first.state, repeated.state);
  assert.equal(first.state.files.length, 4);
  assert.equal(new Set(first.state.files.map((file) => file.id)).size, 4);
  assert.deepEqual(first.state.files.map((file) => file.displayName), ["notes.md", "notes.md", "notes.md", "copy.md"]);
  assert.ok(first.state.files[1].id.startsWith("migrated-"));
  assert.notEqual(first.state.files[1].id, first.state.files[2].id);
  assert.ok(first.state.files[3].id.startsWith("supplied~"));
  assert.ok(first.issues.some((issue) => issue.code === "invalid-legacy-entry"));
  assert.ok(first.issues.some((issue) => issue.code === "duplicate-file"));
  assert.ok(Object.values(first.state.memberships).every((membership) => membership === null));

  const serialized = serializeVirtualFolderState(first.state);
  assert.deepEqual(migrateFlatFileCollection(serialized).state, deserializeVirtualFolderState(serialized).state);
});
