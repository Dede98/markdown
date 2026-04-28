import type { KeyBinding } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { ToolbarItem } from "./toolbarRegistry";

export type EditorContribution = {
  id: string;
  extensions?: Extension[];
  toolbarItems?: ToolbarItem[];
  keymap?: KeyBinding[];
};
