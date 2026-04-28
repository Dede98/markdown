import { Range, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  type KeyBinding,
} from "@codemirror/view";
import { MessageSquarePlus } from "lucide-react";
import type { EditorContribution } from "../editorContributions";
import type { ToolbarItem } from "../toolbarRegistry";
import { parseComments } from "./storage";

type CommentsContributionOptions = {
  onAddComment: () => boolean;
  onOpenComments: () => void;
  onSelectComment: (threadId: string) => void;
};

const commentRangeState = StateField.define<DecorationSet>({
  create: (state) => buildCommentRangeDecorations(state.doc.toString()),
  update: (value, tr) => {
    if (!tr.docChanged) {
      return value;
    }
    return buildCommentRangeDecorations(tr.state.doc.toString());
  },
  provide: (field) => EditorView.decorations.from(field),
});

class CommentMarker extends GutterMarker {
  constructor(
    readonly id: string,
    readonly resolved: boolean,
  ) {
    super();
  }

  eq(other: GutterMarker) {
    return other instanceof CommentMarker && other.id === this.id && other.resolved === this.resolved;
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = this.resolved ? "cm-commentMarker cm-commentMarkerResolved" : "cm-commentMarker";
    marker.title = this.resolved ? "Resolved comment" : "Open comment";
    marker.dataset.commentId = this.id;
    return marker;
  }
}

const commentGutter = gutter({
  class: "cm-commentGutter",
  lineMarker(view, line) {
    const parsed = parseComments(view.state.doc.toString());
    const anchors = parsed.anchors.filter((candidate) => candidate.from >= line.from && candidate.from <= line.to);
    if (anchors.length === 0) {
      return null;
    }
    const openAnchor = anchors.find((anchor) => !parsed.threads[anchor.id]?.resolved);
    const anchor = openAnchor ?? anchors[0];
    return new CommentMarker(anchor.id, Boolean(parsed.threads[anchor.id]?.resolved));
  },
});

export function createCommentsContribution({
  onAddComment,
  onOpenComments,
  onSelectComment,
}: CommentsContributionOptions): EditorContribution {
  const toolbarItems: ToolbarItem[] = [
    {
      type: "button",
      id: "add-comment",
      group: "comments",
      label: "Add comment",
      icon: MessageSquarePlus,
      isDisabled: ({ hasSelection, readOnly }) => !hasSelection || readOnly,
      command: () => onAddComment(),
    },
  ];

  const keymap: KeyBinding[] = [
    {
      key: "Mod-Alt-c",
      preventDefault: true,
      run: () => onAddComment(),
    },
    {
      key: "Mod-Shift-c",
      preventDefault: true,
      run: () => {
        onOpenComments();
        return true;
      },
    },
  ];

  return {
    id: "comments",
    extensions: [
      commentRangeState,
      commentGutter,
      EditorView.domEventHandlers({
        click: (event) => {
          const target = event.target;
          if (!(target instanceof Element)) {
            return false;
          }
          const commentTarget = target.closest<HTMLElement>("[data-comment-id]");
          const threadId = commentTarget?.dataset.commentId;
          if (!threadId) {
            return false;
          }
          event.preventDefault();
          onSelectComment(threadId);
          return true;
        },
      }),
    ],
    toolbarItems,
    keymap,
  };
}

function buildCommentRangeDecorations(markdown: string) {
  const decorations: Range<Decoration>[] = [];
  const parsed = parseComments(markdown);
  for (const anchor of parsed.anchors) {
    if (anchor.from >= anchor.to) {
      continue;
    }
    const thread = parsed.threads[anchor.id];
    const classes = [
      "cm-commentRange",
      thread?.resolved ? "cm-commentRangeResolved" : "",
      parsed.orphanedIds.has(anchor.id) ? "cm-commentRangeOrphaned" : "",
    ].filter(Boolean).join(" ");
    decorations.push(
      Decoration.mark({
        class: classes,
        attributes: { "data-comment-id": anchor.id },
      }).range(anchor.from, anchor.to),
    );
  }
  return Decoration.set(decorations, true);
}
