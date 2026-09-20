import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalSessionPersistence,
  validatePersistedLocalSession,
} from "../../src/sessionPersistence.ts";
import { createTauriSessionFileAdapter } from "../../src/tauriFileAdapter.ts";
import { createWebSessionFileAdapter } from "../../src/webFileAdapter.ts";

function snapshot(files = [], activeFileId = null) {
  return { files, activeFileId };
}

function entry(overrides = {}) {
  return {
    id: "file-a",
    displayName: "notes.md",
    order: 0,
    draft: "saved",
    savedBaseline: "saved",
    dirty: false,
    untitled: false,
    reopen: { kind: "desktop-path", path: "/documents/notes.md" },
    ...overrides,
  };
}

function memoryStorage(initial = null) {
  let current = initial;
  let backup = null;
  return {
    storage: {
      async readCurrent() { return current; },
      async readBackup() { return backup; },
      async writeCurrent(value) { current = value; },
      async writeBackup(value) { backup = value; },
    },
    current: () => current,
    backup: () => backup,
    setCurrent: (value) => { current = value; },
  };
}

test("round trips distinct identities with equal basenames, ordering, selection, and drafts", async () => {
  const memory = memoryStorage();
  const persistence = createLocalSessionPersistence(memory.storage);
  const value = snapshot([
    entry({ id: "left", order: 0, draft: "left draft", savedBaseline: "left saved", dirty: true }),
    entry({
      id: "right",
      order: 1,
      reopen: { kind: "desktop-path", path: "/other/notes.md" },
    }),
  ], "right");

  assert.deepEqual(await persistence.write(value), { status: "written", generation: 1 });
  assert.deepEqual(await persistence.flush(), { status: "flushed", generation: 1 });
  const read = await createLocalSessionPersistence(memory.storage).read();
  assert.equal(read.status, "ok");
  assert.deepEqual(read.snapshot.files.map(({ id, displayName, order }) => ({ id, displayName, order })), [
    { id: "left", displayName: "notes.md", order: 0 },
    { id: "right", displayName: "notes.md", order: 1 },
  ]);
  assert.equal(read.snapshot.activeFileId, "right");
  assert.equal(read.snapshot.files[0].draft, "left draft");
  assert.equal(read.snapshot.files[0].savedBaseline, "left saved");
});

test("round trips an empty session and an untitled dirty draft", async () => {
  const emptyMemory = memoryStorage();
  const empty = createLocalSessionPersistence(emptyMemory.storage);
  await empty.write(snapshot());
  assert.deepEqual((await empty.read()).snapshot.files, []);

  const draftMemory = memoryStorage();
  const draft = createLocalSessionPersistence(draftMemory.storage);
  await draft.write(snapshot([
    entry({
      id: "untitled",
      displayName: "untitled.md",
      draft: "recover me",
      savedBaseline: "",
      dirty: true,
      untitled: true,
      reopen: { kind: "untitled" },
    }),
  ], "untitled"));
  const result = await draft.read();
  assert.equal(result.status, "ok");
  assert.equal(result.snapshot.files[0].untitled, true);
});

test("rejects malformed snapshots, inconsistent dirty state, and unknown versions", async () => {
  assert.throws(() => validatePersistedLocalSession({ version: 1 }), /generation/);
  assert.throws(() => validatePersistedLocalSession({
    version: 1,
    generation: 1,
    activeFileId: "missing",
    files: [entry({ dirty: true })],
  }), /malformed/);

  const malformed = createLocalSessionPersistence(memoryStorage("not json").storage);
  assert.equal((await malformed.read()).status, "malformed");

  const futureMemory = memoryStorage(JSON.stringify({ version: 99 }));
  const future = createLocalSessionPersistence(futureMemory.storage);
  assert.deepEqual(await future.read(), { status: "unsupported-version", version: 99, future: true });
  assert.deepEqual(await future.write(snapshot()), {
    status: "unsupported-version",
    version: 99,
    future: true,
  });
  assert.equal(JSON.parse(futureMemory.current()).version, 99);
  assert.deepEqual(
    await createLocalSessionPersistence(memoryStorage(JSON.stringify({ version: 0 })).storage).read(),
    { status: "unsupported-version", version: 0, future: false },
  );
});

test("recovers the last usable backup after an interrupted write", async () => {
  const original = JSON.stringify({
    version: 1,
    generation: 7,
    ...snapshot([entry()], "file-a"),
  });
  const memory = memoryStorage(original);
  memory.storage.writeCurrent = async () => {
    memory.setCurrent("{interrupted");
    throw new Error("power lost");
  };
  const persistence = createLocalSessionPersistence(memory.storage);
  assert.equal((await persistence.write(snapshot([entry({ draft: "new", savedBaseline: "new" })], "file-a"))).status, "failed");
  assert.equal(memory.backup(), original);
  const recovered = await createLocalSessionPersistence(memory.storage).read();
  assert.equal(recovered.status, "ok");
  assert.equal(recovered.recoveredFromBackup, true);
  assert.equal(recovered.snapshot.generation, 7);
});

test("reports unavailable reads and writes while retaining the last usable in memory", async () => {
  const initial = JSON.stringify({ version: 1, generation: 2, ...snapshot([entry()], "file-a") });
  const memory = memoryStorage(initial);
  const persistence = createLocalSessionPersistence(memory.storage);
  assert.equal((await persistence.read()).status, "ok");
  memory.storage.readCurrent = async () => { throw new Error("storage denied"); };
  const read = await persistence.read();
  assert.equal(read.status, "unavailable");
  assert.equal(read.lastUsable.generation, 2);
  assert.equal((await persistence.write(snapshot())).status, "unavailable");
});

test("serializes writes and flush waits for the newest durable completion", async () => {
  let current = null;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const starts = [];
  const storage = {
    async readCurrent() { return current; },
    async readBackup() { return null; },
    async writeBackup() {},
    async writeCurrent(value) {
      starts.push(JSON.parse(value).files[0].draft);
      if (starts.length === 1) await firstGate;
      current = value;
    },
  };
  const persistence = createLocalSessionPersistence(storage);
  const first = persistence.write(snapshot([entry({ draft: "first", savedBaseline: "first" })], "file-a"));
  const second = persistence.write(snapshot([entry({ draft: "second", savedBaseline: "second" })], "file-a"));
  let flushed = false;
  const flush = persistence.flush().then((value) => { flushed = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(starts, ["first"]);
  assert.equal(flushed, false);
  releaseFirst();
  assert.equal((await first).status, "written");
  assert.deepEqual(await second, { status: "written", generation: 2 });
  assert.deepEqual(await flush, { status: "flushed", generation: 2 });
  assert.equal(JSON.parse(current).files[0].draft, "second");
});

test("continues the serialized queue after a failed write", async () => {
  let attempts = 0;
  let current = null;
  const persistence = createLocalSessionPersistence({
    async readCurrent() { return current; },
    async readBackup() { return null; },
    async writeBackup() {},
    async writeCurrent(value) {
      attempts += 1;
      if (attempts === 1) throw new Error("disk full");
      current = value;
    },
  });
  const failed = persistence.write(snapshot());
  const succeeded = persistence.write(snapshot([entry()], "file-a"));
  assert.equal((await failed).status, "failed");
  assert.equal((await succeeded).status, "written");
  assert.equal(JSON.parse(current).files.length, 1);
});

test("desktop reconnect reports success, missing, denied, and unavailable outcomes", async () => {
  const reference = { kind: "desktop-path", path: "/documents/notes.md" };
  const success = createTauriSessionFileAdapter(async () => "# notes");
  assert.deepEqual(await success.reconnect(reference), {
    status: "reopened",
    file: { name: "notes.md", contents: "# notes", handle: reference.path },
  });
  for (const [message, status] of [
    ["ENOENT no such file", "missing"],
    ["path outside fs scope", "denied"],
    ["bridge offline", "unavailable"],
  ]) {
    const adapter = createTauriSessionFileAdapter(async () => { throw new Error(message); });
    assert.equal((await adapter.reconnect(reference)).status, status);
  }
});

test("browser adapter keeps opaque handles in its capability store", async () => {
  const handles = new Map();
  const store = {
    async put(id, handle) { handles.set(id, handle); },
    async get(id) { return handles.get(id); },
  };
  const handle = {
    kind: "file",
    name: "notes.md",
    async queryPermission() { return "granted"; },
    async getFile() { return { async text() { return "browser text"; } }; },
    async createWritable() { throw new Error("unused"); },
    async requestPermission() { return "granted"; },
    toJSON() { throw new Error("opaque handle was serialized"); },
  };
  const adapter = createWebSessionFileAdapter(store);
  const reference = await adapter.createReference(handle, false);
  assert.equal(reference.kind, "browser-capability");
  assert.equal(reference.status, "granted");
  assert.strictEqual(handles.get(reference.capabilityId), handle);
  assert.equal(JSON.stringify(reference).includes("browser text"), false);
  assert.strictEqual((await adapter.reconnect(reference)).file.handle, handle);

  handle.queryPermission = async () => "prompt";
  assert.equal((await adapter.reconnect(reference)).status, "permission-needed");
  assert.equal((await adapter.reconnect(reference, { requestPermission: true })).status, "reopened");
  handle.queryPermission = async () => "denied";
  assert.equal((await adapter.reconnect(reference)).status, "denied");

  assert.deepEqual(await adapter.createReference(null, false), {
    kind: "browser-upload-only",
    status: "upload-only",
  });
  assert.equal((await adapter.reconnect({ kind: "browser-upload-only", status: "upload-only" })).status, "upload-required");
});

test("adapter mocks prove boundary outcomes, not an actual native process restart", () => {
  // The desktop tests above inject the scoped read IPC boundary. They verify
  // result classification only; a packaged-app restart remains native QA.
  assert.ok(true);
});
