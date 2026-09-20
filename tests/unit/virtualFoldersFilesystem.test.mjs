import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addFileReference,
  assignFile,
  createFolder,
  deserializeVirtualFolderState,
  fileId,
  folderId,
  removeFolder,
  renameFolder,
  serializeVirtualFolderState,
} from "../../src/virtualFolders.ts";

function succeed(result) {
  assert.equal(result.ok, true, result.ok ? undefined : result.error.message);
  return result.state;
}

test("folder workflow keeps duplicate-basename sources untouched in a disposable directory", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "markdown-folders-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const leftDirectory = join(root, "left");
  const rightDirectory = join(root, "right");
  await mkdir(leftDirectory);
  await mkdir(rightDirectory);
  const leftPath = join(leftDirectory, "notes.md");
  const rightPath = join(rightDirectory, "notes.md");
  const draftDestination = join(root, "draft.md");
  await writeFile(leftPath, "left disk bytes");
  await writeFile(rightPath, "right disk bytes");

  let state = succeed(createFolder({ folders: [], files: [], memberships: {}, sessions: [] }, {
    id: folderId("tech"),
    name: "Tech",
  }));
  state = succeed(createFolder(state, { id: folderId("archive"), name: "Archive" }));
  state = succeed(addFileReference(state, { id: fileId(leftPath), displayName: "notes.md" }));
  state = succeed(addFileReference(state, { id: fileId(rightPath), displayName: "notes.md" }));
  state = succeed(addFileReference(state, { id: fileId("draft"), displayName: "untitled.md" }));
  state = succeed(assignFile(state, fileId(leftPath), folderId("tech")));
  state = succeed(assignFile(state, fileId(rightPath), folderId("tech")));
  state = succeed(assignFile(state, fileId("draft"), folderId("tech")));
  state = succeed(assignFile(state, fileId(rightPath), folderId("archive")));

  const restarted = deserializeVirtualFolderState(serializeVirtualFolderState(state)).state;
  assert.equal(restarted.memberships[leftPath], "tech");
  assert.equal(restarted.memberships[rightPath], "archive");
  assert.equal(restarted.memberships.draft, "tech");
  await assert.rejects(stat(draftDestination), { code: "ENOENT" });

  state = succeed(renameFolder(restarted, folderId("tech"), "Engineering"));
  state = succeed(removeFolder(state, folderId("tech")));
  assert.equal(state.memberships[leftPath], null);
  assert.equal(state.memberships.draft, null);
  assert.equal(await readFile(leftPath, "utf8"), "left disk bytes");
  assert.equal(await readFile(rightPath, "utf8"), "right disk bytes");

  // Only an explicit save operation creates a physical destination for the draft.
  await writeFile(draftDestination, "draft bytes");
  assert.equal(await readFile(draftDestination, "utf8"), "draft bytes");
  assert.equal(await readFile(leftPath, "utf8"), "left disk bytes");
  assert.equal(await readFile(rightPath, "utf8"), "right disk bytes");
});
