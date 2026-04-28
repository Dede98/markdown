import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table as TableIcon,
  Underline,
  type LucideIcon,
} from "lucide-react";
import type { ActiveFormat } from "./editorFormat";
import { insertBlock, insertLink, setHeading, toggleLinePrefix, wrapSelection } from "./markdownCommands";

export type ToolbarContext = {
  activeFormat: ActiveFormat;
  hasSelection: boolean;
  readOnly: boolean;
};

export type ToolbarButtonItem = {
  type: "button";
  id: string;
  group: string;
  label: string;
  icon: LucideIcon;
  isActive?: (context: ToolbarContext) => boolean;
  isDisabled?: (context: ToolbarContext) => boolean;
  command: (view: EditorView) => boolean;
};

export type ToolbarSelectItem = {
  type: "select";
  id: string;
  group: string;
  label: string;
  value: (context: ToolbarContext) => string;
  options: Array<{ label: string; value: string; disabled?: boolean }>;
  command: (view: EditorView, value: string) => boolean;
};

export type ToolbarDividerItem = {
  type: "divider";
  id: string;
};

export type ToolbarItem = ToolbarButtonItem | ToolbarSelectItem | ToolbarDividerItem;

export const markdownToolbarItems: ToolbarItem[] = [
  {
    type: "select",
    id: "heading-level",
    group: "headings",
    label: "Heading level",
    value: ({ activeFormat }) => (activeFormat.heading ? String(activeFormat.heading) : ""),
    options: [
      { label: "Heading", value: "", disabled: true },
      { label: "Heading 1", value: "1" },
      { label: "Heading 2", value: "2" },
      { label: "Heading 3", value: "3" },
      { label: "Heading 4", value: "4" },
      { label: "Heading 5", value: "5" },
      { label: "Heading 6", value: "6" },
    ],
    command: (view, value) => {
      const level = Number(value);
      if (level < 1 || level > 6) {
        return false;
      }
      return setHeading(view, level as 1 | 2 | 3 | 4 | 5 | 6);
    },
  },
  { type: "divider", id: "after-heading-select" },
  {
    type: "button",
    id: "heading-1",
    group: "headings",
    label: "Heading 1",
    icon: Heading1,
    isActive: ({ activeFormat }) => activeFormat.heading === 1,
    command: (view) => setHeading(view, 1),
  },
  {
    type: "button",
    id: "heading-2",
    group: "headings",
    label: "Heading 2",
    icon: Heading2,
    isActive: ({ activeFormat }) => activeFormat.heading === 2,
    command: (view) => setHeading(view, 2),
  },
  {
    type: "button",
    id: "heading-3",
    group: "headings",
    label: "Heading 3",
    icon: Heading3,
    isActive: ({ activeFormat }) => activeFormat.heading === 3,
    command: (view) => setHeading(view, 3),
  },
  {
    type: "button",
    id: "bold",
    group: "inline",
    label: "Bold",
    icon: Bold,
    isActive: ({ activeFormat }) => activeFormat.bold,
    command: (view) => wrapSelection(view, { before: "**", after: "**", placeholder: "bold" }),
  },
  {
    type: "button",
    id: "italic",
    group: "inline",
    label: "Italic",
    icon: Italic,
    isActive: ({ activeFormat }) => activeFormat.italic,
    command: (view) => wrapSelection(view, { before: "*", after: "*", placeholder: "italic" }),
  },
  {
    type: "button",
    id: "underline",
    group: "inline",
    label: "Underline",
    icon: Underline,
    isActive: ({ activeFormat }) => activeFormat.underline,
    command: (view) => wrapSelection(view, { before: "<u>", after: "</u>", placeholder: "underline" }),
  },
  {
    type: "button",
    id: "strikethrough",
    group: "inline",
    label: "Strikethrough",
    icon: Strikethrough,
    isActive: ({ activeFormat }) => activeFormat.strike,
    command: (view) => wrapSelection(view, { before: "~~", after: "~~", placeholder: "strike" }),
  },
  {
    type: "button",
    id: "inline-code",
    group: "inline",
    label: "Inline code",
    icon: Code,
    isActive: ({ activeFormat }) => activeFormat.inlineCode,
    command: (view) => wrapSelection(view, { before: "`", after: "`", placeholder: "code" }),
  },
  {
    type: "button",
    id: "code-block",
    group: "blocks",
    label: "Code block",
    icon: Code2,
    isActive: ({ activeFormat }) => activeFormat.codeBlock,
    command: (view) => insertBlock(view, "```js\ncode\n```\n"),
  },
  {
    type: "button",
    id: "link",
    group: "inline",
    label: "Link",
    icon: Link,
    isActive: ({ activeFormat }) => activeFormat.link,
    command: insertLink,
  },
  { type: "divider", id: "after-inline" },
  {
    type: "button",
    id: "unordered-list",
    group: "lists",
    label: "Bulleted list",
    icon: List,
    isActive: ({ activeFormat }) => activeFormat.unorderedList,
    command: (view) => toggleLinePrefix(view, "- "),
  },
  {
    type: "button",
    id: "ordered-list",
    group: "lists",
    label: "Numbered list",
    icon: ListOrdered,
    isActive: ({ activeFormat }) => activeFormat.orderedList,
    command: (view) => toggleLinePrefix(view, "1. "),
  },
  {
    type: "button",
    id: "task-list",
    group: "lists",
    label: "Task list",
    icon: ListChecks,
    isActive: ({ activeFormat }) => activeFormat.taskList,
    command: (view) => toggleLinePrefix(view, "- [ ] "),
  },
  {
    type: "button",
    id: "blockquote",
    group: "blocks",
    label: "Blockquote",
    icon: Quote,
    isActive: ({ activeFormat }) => activeFormat.quote,
    command: (view) => toggleLinePrefix(view, "> "),
  },
  {
    type: "button",
    id: "horizontal-rule",
    group: "blocks",
    label: "Horizontal rule",
    icon: Minus,
    isActive: ({ activeFormat }) => activeFormat.rule,
    command: (view) => insertBlock(view, "---\n"),
  },
  {
    type: "button",
    id: "table",
    group: "blocks",
    label: "Table",
    icon: TableIcon,
    isActive: ({ activeFormat }) => activeFormat.table,
    command: (view) => insertBlock(view, "| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell     | Cell     |\n"),
  },
];
