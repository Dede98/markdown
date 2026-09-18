import { expect, type Page, test, type TestInfo } from "@playwright/test";

type OpenFile = { name: string; contents: string; handleId: string };

async function installSessionAdapter(
  page: Page,
  files: OpenFile[],
  options: { delaySaves?: boolean; cancelSaveAs?: boolean; failOpen?: boolean } = {},
) {
  await page.addInitScript(
    ({ openFiles, delaySaves, cancelSaveAs, failOpen }) => {
      type Call = { kind: string; name?: string; contents?: string; handleId?: string };
      const win = window as unknown as {
        __markdownFileAdapterOverride: unknown;
        __sessionCalls: Call[];
        __resolveSessionSaves: () => void;
      };
      let openIndex = 0;
      let releaseSaves: (() => void) | null = null;
      const saveGate = delaySaves
        ? new Promise<void>((resolve) => {
            releaseSaves = resolve;
          })
        : Promise.resolve();

      win.__sessionCalls = [];
      win.__resolveSessionSaves = () => releaseSaves?.();
      win.__markdownFileAdapterOverride = {
        canSaveInPlace: () => true,
        newFile: () => ({ name: "untitled.md", contents: "", handle: null }),
        openFile: async () => {
          win.__sessionCalls.push({ kind: "open" });
          if (failOpen) {
            throw new Error("picker failed");
          }
          const next = openFiles[openIndex++];
          return next
            ? {
                name: next.name,
                contents: next.contents,
                handle: { id: next.handleId },
              }
            : null;
        },
        saveFile: async (handle: { id: string }, contents: string, name: string) => {
          win.__sessionCalls.push({
            kind: "save",
            name,
            contents,
            handleId: handle.id,
          });
          await saveGate;
          return { name, handle };
        },
        saveFileAs: async (name: string, contents: string) => {
          win.__sessionCalls.push({ kind: "saveAs", name, contents });
          await saveGate;
          return cancelSaveAs ? null : { name: `saved-${name}`, handle: { id: `saved-${name}` } };
        },
      };
    },
    { openFiles: files, ...options },
  );
}

async function enableAfterEditAutosave(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("markdown.autosave.mode", "after-edit");
    window.localStorage.setItem("markdown.autosave.intervalSeconds", "30");
  });
}

async function installBrowserPickerFailures(page: Page) {
  await page.addInitScript(() => {
    let openAttempts = 0;
    const win = window as unknown as {
      showOpenFilePicker: () => Promise<never>;
      showSaveFilePicker: () => Promise<never>;
    };
    win.showSaveFilePicker = async () => {
      throw new DOMException("cancelled", "AbortError");
    };
    win.showOpenFilePicker = async () => {
      openAttempts += 1;
      if (openAttempts === 1) {
        throw new DOMException("cancelled", "AbortError");
      }
      throw new Error("browser picker failed");
    };
  });
}

async function installTauriIpc(page: Page, pathContents: Record<string, string> = {}) {
  await page.addInitScript((files) => {
    type TauriEvent = { event: string; payload: unknown; id: number };
    type Callback = (event: TauriEvent) => void;
    const callbacks = new Map<number, Callback>();
    const listeners = new Map<string, number[]>();
    let nextCallbackId = 1;

    const win = window as unknown as {
      __TAURI_INTERNALS__: Record<string, unknown>;
      __TAURI_EVENT_PLUGIN_INTERNALS__: Record<string, unknown>;
      __emitTauriEvent: (event: string, payload?: unknown) => void;
      __tauriDialogOpenResult: string | null;
      __tauriDialogSaveResult: string | null;
      __tauriFailReads: boolean;
      __tauriFailWrites: boolean;
    };

    win.__tauriDialogOpenResult = null;
    win.__tauriDialogSaveResult = null;
    win.__tauriFailReads = false;
    win.__tauriFailWrites = false;
    win.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback(callback: Callback) {
        const id = nextCallbackId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      convertFileSrc(path: string) {
        return path;
      },
      async invoke(cmd: string, args?: Record<string, unknown>) {
        if (cmd === "plugin:event|listen") {
          const event = String(args?.event);
          const handler = Number(args?.handler);
          listeners.set(event, [...(listeners.get(event) ?? []), handler]);
          return handler;
        }
        if (cmd === "plugin:event|unlisten") {
          const event = String(args?.event);
          const id = Number(args?.eventId);
          listeners.set(event, (listeners.get(event) ?? []).filter((candidate) => candidate !== id));
          return null;
        }
        if (cmd === "drain_pending_open_paths") {
          return [];
        }
        if (cmd === "plugin:dialog|open") {
          return win.__tauriDialogOpenResult;
        }
        if (cmd === "plugin:dialog|save") {
          return win.__tauriDialogSaveResult;
        }
        if (cmd === "plugin:fs|read_text_file") {
          if (win.__tauriFailReads) {
            throw new Error("native read failed");
          }
          const value = files[String(args?.path)] ?? "";
          return Array.from(new TextEncoder().encode(value));
        }
        if (cmd === "plugin:fs|write_text_file") {
          if (win.__tauriFailWrites) {
            throw new Error("native write failed");
          }
          return null;
        }
        if (cmd === "plugin:updater|check") {
          return null;
        }
        return null;
      },
    };
    win.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(_event: string, id: number) {
        callbacks.delete(id);
      },
    };
    win.__emitTauriEvent = (event, payload = null) => {
      for (const id of listeners.get(event) ?? []) {
        callbacks.get(id)?.({ event, payload, id });
      }
    };
  }, pathContents);
}

test.describe("file sidebar integration", () => {
  test("keeps two same-named files and a stable untitled draft independently", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installSessionAdapter(page, [
      { name: "notes.md", contents: "first copy", handleId: "first" },
      { name: "notes.md", contents: "second copy", handleId: "second" },
    ]);
    await page.goto("/");

    await page.getByRole("button", { name: "Close untitled.md" }).click();
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("button", { name: "New file" }).click();

    const sidebar = page.getByRole("navigation", { name: "Open files" });
    await expect(sidebar.getByRole("button", { name: "Select notes.md", exact: true })).toHaveCount(2);
    await expect(sidebar.getByRole("button", { name: "Select untitled.md", exact: true })).toHaveCount(1);

    const firstNotes = sidebar.getByRole("button", { name: "Select notes.md", exact: true }).first();
    await firstNotes.click();
    await expect.poll(() => getEditorSource(page)).toBe("first copy");
    await setEditorText(page, "edited first copy");
    await expect(sidebar.getByRole("button", { name: "Select notes.md, unsaved changes" })).toHaveCount(1);

    await sidebar.getByRole("button", { name: "Select notes.md", exact: true }).click();
    await expect.poll(() => getEditorSource(page)).toBe("second copy");
    const dirtyFirstNotes = sidebar.getByRole("button", {
      name: "Select notes.md, unsaved changes",
    });
    await dirtyFirstNotes.click();
    await expect.poll(() => getEditorSource(page)).toBe("edited first copy");
    await expect(dirtyFirstNotes).toHaveAttribute("aria-current", "page");

    await page.getByRole("button", { name: "Save file" }).click();
    await expect(page.locator(".documentState")).toHaveText("Saved");
    expect(await sessionCalls(page)).toContainEqual({
      kind: "save",
      name: "notes.md",
      contents: "edited first copy",
      handleId: "first",
    });
  });

  test("closes clean files and keeps a dirty file when discard is cancelled", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installSessionAdapter(page, [
      { name: "clean.md", contents: "clean", handleId: "clean" },
      { name: "dirty.md", contents: "before", handleId: "dirty" },
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("button", { name: "Open file" }).click();

    await page.getByRole("button", { name: "Close clean.md" }).click();
    await expect(page.getByRole("button", { name: "Select clean.md" })).toHaveCount(0);

    await setEditorText(page, "changed");
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.getByRole("button", { name: "Close dirty.md" }).click();
    await expect(page.getByRole("button", { name: "Select dirty.md, unsaved changes" })).toBeVisible();
    await expect.poll(() => getEditorSource(page)).toBe("changed");
  });

  test("a delayed save updates only its captured live session", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installSessionAdapter(
      page,
      [
        { name: "one.md", contents: "one", handleId: "one" },
        { name: "two.md", contents: "two", handleId: "two" },
      ],
      { delaySaves: true },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("button", { name: "Select one.md" }).click();
    await setEditorText(page, "one changed");
    await page.getByRole("button", { name: "Save file" }).click();

    await page.getByRole("button", { name: "Select two.md" }).click();
    await setEditorText(page, "two changed");
    await page.evaluate(() =>
      (window as unknown as { __resolveSessionSaves: () => void }).__resolveSessionSaves(),
    );

    await expect.poll(() => getEditorSource(page)).toBe("two changed");
    await expect(page.getByRole("button", { name: "Select two.md, unsaved changes" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("button", { name: "Select one.md", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Select one.md", exact: true }).click();
    await expect.poll(() => getEditorSource(page)).toBe("one changed");
    await expect(page.locator(".documentState")).toHaveText("Saved");
  });

  test("Save As after switching renames and saves only the active session", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installSessionAdapter(page, [
      { name: "one.md", contents: "one", handleId: "one" },
      { name: "two.md", contents: "two", handleId: "two" },
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("button", { name: "Select one.md" }).click();
    await setEditorText(page, "one saved elsewhere");

    await page.keyboard.press("Control+Shift+S");
    await expect(page.getByRole("button", { name: "Select saved-one.md", exact: true })).toBeVisible();
    expect(await sessionCalls(page)).toContainEqual({
      kind: "saveAs",
      name: "one.md",
      contents: "one saved elsewhere",
    });

    await page.getByRole("button", { name: "Select two.md" }).click();
    await expect.poll(() => getEditorSource(page)).toBe("two");
  });

  test("autosave and the keyboard save shortcut use the current session identity", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await enableAfterEditAutosave(page);
    await installSessionAdapter(page, [
      { name: "one.md", contents: "one", handleId: "one" },
      { name: "two.md", contents: "two", handleId: "two" },
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("button", { name: "Open file" }).click();

    await setEditorText(page, "two by keyboard");
    await page.keyboard.press("Control+S");
    await expect.poll(async () => (await sessionCalls(page)).filter((call: { kind: string }) => call.kind === "save").length).toBe(1);
    expect(await sessionCalls(page)).toContainEqual({
      kind: "save",
      name: "two.md",
      contents: "two by keyboard",
      handleId: "two",
    });

    await page.getByRole("button", { name: "Select one.md" }).click();
    await setEditorText(page, "one by autosave");
    await expect.poll(async () => sessionCalls(page), { timeout: 5_000 }).toContainEqual({
      kind: "save",
      name: "one.md",
      contents: "one by autosave",
      handleId: "one",
    });
    await page.getByRole("button", { name: "Select two.md" }).click();
    await expect.poll(() => getEditorSource(page)).toBe("two by keyboard");
  });

  test("native menu save and OS open events keep their session identities", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installTauriIpc(page, { "/tmp/from-finder.md": "opened by the OS" });
    await installSessionAdapter(page, [
      { name: "menu.md", contents: "menu original", handleId: "menu" },
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: "Open file" }).click();
    await setEditorText(page, "menu changed");
    await emitTauriEvent(page, "menu:save");
    await expect.poll(async () => sessionCalls(page)).toContainEqual({
      kind: "save",
      name: "menu.md",
      contents: "menu changed",
      handleId: "menu",
    });

    await emitTauriEvent(page, "file:open-path", "/tmp/from-finder.md");
    await expect(page.getByRole("button", { name: "Select from-finder.md" })).toBeVisible();
    await expect.poll(() => getEditorSource(page)).toBe("opened by the OS");
    await page.getByRole("button", { name: "Select menu.md" }).click();
    await expect.poll(() => getEditorSource(page)).toBe("menu changed");
  });

  test("does not resurrect a session closed while its save is pending", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await installSessionAdapter(
      page,
      [{ name: "closing.md", contents: "before", handleId: "closing" }],
      { delaySaves: true },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Open file" }).click();
    await setEditorText(page, "pending write");
    await page.getByRole("button", { name: "Save file" }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Close closing.md" }).click();
    await page.evaluate(() =>
      (window as unknown as { __resolveSessionSaves: () => void }).__resolveSessionSaves(),
    );
    await expect(page.getByRole("button", { name: /Select closing\.md/ })).toHaveCount(0);
  });

  test("hide is reversible and Zen restores the previous sidebar preference", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByRole("navigation", { name: "Open files" });
    await expect(sidebar).toBeVisible();
    await page.getByRole("button", { name: "Hide file sidebar" }).click();
    await expect(sidebar).toBeHidden();
    await page.getByRole("button", { name: "Show file sidebar" }).click();
    await expect(sidebar).toBeVisible();

    await page.getByTitle("Zen Mode").click();
    await expect(sidebar).toBeHidden();
    await page.getByTitle(/Normal Mode/).click();
    await expect(sidebar).toBeVisible();
  });

  test("gates local switching during collaboration and retains right panels", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Start collaboration room").click();
    await expect(page.getByRole("complementary", { name: "Collaboration spike" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Open files" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByRole("button", { name: "New file" })).toBeDisabled();

    await page.getByRole("button", { name: "Comments" }).click();
    await expect(page.getByRole("complementary", { name: "Comments" })).toBeVisible();
    await page.getByRole("button", { name: "Leave room" }).click();
    await expect(page.getByRole("navigation", { name: "Open files" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("long names and both side panels do not create page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 760 });
    await installSessionAdapter(page, [
      {
        name: "an-extremely-long-markdown-file-name-that-must-not-expand-the-layout.md",
        contents: "# Narrow",
        handleId: "long",
      },
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("button", { name: "Comments" }).click();
    await page.getByLabel("Start collaboration room").click();

    expect(
      await page.evaluate(() => ({
        body: document.body.scrollWidth,
        root: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      })),
    ).toEqual({ body: 640, root: 640, viewport: 640 });
    await expect(page.locator(".editorShell")).toBeVisible();
  });

  test("browser picker cancellation and errors preserve the current buffer", async ({ page }) => {
    await installBrowserPickerFailures(page);
    await page.goto("/");
    await setEditorText(page, "keep me");
    await page.getByRole("button", { name: "Save file" }).click();
    await expect.poll(() => getEditorSource(page)).toBe("keep me");
    await expect(page.locator(".documentState")).toHaveText("Unsaved");

    await page.getByRole("button", { name: "Open file" }).click();
    await expect.poll(() => getEditorSource(page)).toBe("keep me");
    await expect(page.locator(".documentState")).toHaveText("Unsaved");

    await page.getByRole("button", { name: "Open file" }).click();
    await expect.poll(() => getEditorSource(page)).toBe("keep me");
    await expect(page.locator(".documentState")).toHaveText("Save failed");
  });

  test("browser upload/download fallback preserves the other open buffer", async ({ page }, testInfo) => {
    skipMobileKeyboardTest(testInfo);
    await page.addInitScript(() => {
      Object.defineProperty(window, "showOpenFilePicker", { value: undefined, configurable: true });
      Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
    });
    await page.goto("/");
    await setEditorText(page, "unsaved original");

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open file" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "uploaded.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("uploaded contents"),
    });
    await expect.poll(() => getEditorSource(page)).toBe("uploaded contents");

    await setEditorText(page, "downloaded contents");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save file" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("uploaded.md");
    await expect(page.getByRole("button", { name: "Select uploaded.md", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Select untitled.md, unsaved changes" }).click();
    await expect.poll(() => getEditorSource(page)).toBe("unsaved original");
  });

  test("Tauri picker cancellation and read errors preserve the active buffer", async ({ page }) => {
    await installTauriIpc(page);
    await page.goto("/");
    await setEditorText(page, "native buffer");

    await page.getByRole("button", { name: "Save file" }).click();
    await page.getByRole("button", { name: "Open file" }).click();
    await expect.poll(() => getEditorSource(page)).toBe("native buffer");
    await expect(page.locator(".documentState")).toHaveText("Unsaved");

    await page.evaluate(() => {
      const win = window as unknown as {
        __tauriDialogOpenResult: string | null;
        __tauriFailReads: boolean;
      };
      win.__tauriDialogOpenResult = "/tmp/unreadable.md";
      win.__tauriFailReads = true;
    });
    await page.getByRole("button", { name: "Open file" }).click();
    await expect.poll(() => getEditorSource(page)).toBe("native buffer");
    await expect(page.locator(".documentState")).toHaveText("Save failed");
  });
});

async function setEditorText(page: Page, text: string) {
  await page.evaluate((nextText) => {
    const view = (
      window as unknown as {
        __markdownEditorView?: {
          state: { doc: { length: number } };
          dispatch: (spec: unknown) => void;
        };
      }
    ).__markdownEditorView;
    if (!view) {
      throw new Error("CodeMirror editor view is not available");
    }
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: nextText } });
  }, text);
}

async function getEditorSource(page: Page) {
  return page.evaluate(() => {
    const view = (
      window as unknown as {
        __markdownEditorView?: { state: { doc: { toString: () => string } } };
      }
    ).__markdownEditorView;
    if (!view) {
      throw new Error("CodeMirror editor view is not available");
    }
    return view.state.doc.toString();
  });
}

async function sessionCalls(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __sessionCalls: unknown[] }).__sessionCalls,
  );
}

async function emitTauriEvent(page: Page, event: string, payload?: unknown) {
  await expect.poll(() => page.evaluate((name) => {
    const emit = (window as unknown as { __emitTauriEvent?: (event: string) => void }).__emitTauriEvent;
    return typeof emit === "function" && name.length > 0;
  }, event)).toBe(true);
  await page.evaluate(
    ({ name, data }) => {
      (window as unknown as { __emitTauriEvent: (event: string, payload?: unknown) => void })
        .__emitTauriEvent(name, data);
    },
    { name: event, data: payload },
  );
}

function skipMobileKeyboardTest(testInfo: TestInfo) {
  test.skip(
    testInfo.project.name === "chrome-mobile",
    "Session mutation paths are covered on desktop; mobile layout has dedicated coverage.",
  );
}
