declare module "y-codemirror.next" {
  import type { Extension } from "@codemirror/state";
  import type * as Y from "yjs";

  export type YAwarenessLike = {
    doc: { clientID: number };
    getLocalState(): Record<string, unknown> | null;
    getStates(): Map<number, Record<string, unknown>>;
    setLocalStateField(field: string, value: unknown): void;
    on(event: "change", listener: (change: { added: number[]; updated: number[]; removed: number[] }) => void): void;
    off(event: "change", listener: (change: { added: number[]; updated: number[]; removed: number[] }) => void): void;
  };

  export function yCollab(
    ytext: Y.Text,
    awareness?: YAwarenessLike | null,
    opts?: { undoManager?: Y.UndoManager | false },
  ): Extension;
}

