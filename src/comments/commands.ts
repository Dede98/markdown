import type { EditorView } from "@codemirror/view";
import { ulid } from "ulid";
import type { MarkdownCommand } from "../markdownCommands";
import { parseComments, replaceMetadataBlock } from "./storage";
import type { CommentAuthor, CommentReply, CommentThread } from "./types";

type InsertCommentAnchorArgs = {
  threadId: string;
  author: CommentAuthor;
  now: string;
};

type AddCommentReplyArgs = {
  threadId: string;
  author: CommentAuthor;
  body: string;
  now: string;
};

type ResolveCommentThreadArgs = {
  threadId: string;
  resolved: boolean;
};

type ReanchorCommentThreadArgs = {
  threadId: string;
};

type DeleteCommentThreadArgs = {
  threadId: string;
};

export function createThreadId() {
  return ulid();
}

export const insertCommentAnchor: MarkdownCommand<InsertCommentAnchorArgs> = (view, args) => {
  const { state } = view;
  const selection = state.selection.main;
  if (selection.empty) {
    return false;
  }

  const markdown = state.doc.toString();
  const parsed = parseComments(markdown);
  if (parsed.readOnlyReason) {
    return false;
  }
  if (parsed.metadataBlock && selection.from < parsed.metadataBlock.to && selection.to > parsed.metadataBlock.from) {
    return false;
  }

  const selected = state.sliceDoc(selection.from, selection.to);
  const opening = `<!--c:${args.threadId}-->`;
  const closing = `<!--/c:${args.threadId}-->`;
  const withAnchor = `${markdown.slice(0, selection.from)}${opening}${selected}${closing}${markdown.slice(selection.to)}`;
  const threads = {
    ...parsed.threads,
    [args.threadId]: {
      id: args.threadId,
      createdAt: args.now,
      resolved: false,
      replies: [],
    },
  };
  const nextMarkdown = replaceMetadataBlock(withAnchor, threads);
  const anchor = selection.from + opening.length;
  const head = anchor + selected.length;

  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: nextMarkdown },
    selection: { anchor, head },
  });
  view.focus();
  return true;
};

export const addCommentReply: MarkdownCommand<AddCommentReplyArgs> = (view, args) => {
  const body = args.body.trim();
  if (!body) {
    return false;
  }
  return updateThread(view, args.threadId, (thread) => ({
    ...thread,
    replies: [
      ...thread.replies,
      {
        id: `r_${ulid()}`,
        author: args.author,
        ts: args.now,
        body,
      } satisfies CommentReply,
    ],
  }));
};

export const resolveCommentThread: MarkdownCommand<ResolveCommentThreadArgs> = (view, args) => (
  updateThread(view, args.threadId, (thread) => ({ ...thread, resolved: args.resolved }))
);

export const reanchorCommentThread: MarkdownCommand<ReanchorCommentThreadArgs> = (view, args) => {
  const { state } = view;
  const selection = state.selection.main;
  if (selection.empty) {
    return false;
  }

  const markdown = state.doc.toString();
  const parsed = parseComments(markdown);
  if (parsed.readOnlyReason || !parsed.threads[args.threadId]) {
    return false;
  }
  if (parsed.metadataBlock && selection.from < parsed.metadataBlock.to && selection.to > parsed.metadataBlock.from) {
    return false;
  }

  const selected = state.sliceDoc(selection.from, selection.to);
  const withoutMarkers = removeCommentMarkers(markdown, args.threadId);
  const from = adjustPosition(selection.from, withoutMarkers.removedRanges);
  const to = adjustPosition(selection.to, withoutMarkers.removedRanges);
  const opening = `<!--c:${args.threadId}-->`;
  const closing = `<!--/c:${args.threadId}-->`;
  const withAnchor = `${withoutMarkers.markdown.slice(0, from)}${opening}${selected}${closing}${withoutMarkers.markdown.slice(to)}`;
  const nextMarkdown = replaceMetadataBlock(withAnchor, parsed.threads);
  const anchor = from + opening.length;
  const head = anchor + selected.length;

  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: nextMarkdown },
    selection: { anchor, head },
    scrollIntoView: true,
  });
  view.focus();
  return true;
};

export const deleteCommentThread: MarkdownCommand<DeleteCommentThreadArgs> = (view, args) => {
  const markdown = view.state.doc.toString();
  const parsed = parseComments(markdown);
  if (parsed.readOnlyReason) {
    return false;
  }

  const { [args.threadId]: _deletedThread, ...threads } = parsed.threads;
  const withoutMarkers = removeCommentMarkers(markdown, args.threadId);
  const nextMarkdown = replaceMetadataBlock(withoutMarkers.markdown, threads);

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: nextMarkdown },
  });
  view.focus();
  return true;
};

function updateThread(
  view: EditorView,
  threadId: string,
  update: (thread: CommentThread) => CommentThread,
) {
  const markdown = view.state.doc.toString();
  const parsed = parseComments(markdown);
  if (parsed.readOnlyReason) {
    return false;
  }
  const thread = parsed.threads[threadId];
  if (!thread) {
    return false;
  }
  const threads = {
    ...parsed.threads,
    [threadId]: update(thread),
  };
  const nextMarkdown = replaceMetadataBlock(markdown, threads);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: nextMarkdown },
  });
  view.focus();
  return true;
}

function removeCommentMarkers(markdown: string, threadId: string) {
  const markerPattern = new RegExp(`<!--/?c:${threadId}-->`, "gu");
  const parsed = parseComments(markdown);
  const limit = parsed.metadataBlock?.from ?? markdown.length;
  const source = markdown.slice(0, limit);
  const removedRanges: Array<{ from: number; to: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = markerPattern.exec(source))) {
    removedRanges.push({ from: match.index, to: match.index + match[0].length });
  }

  if (removedRanges.length === 0) {
    return { markdown, removedRanges };
  }

  let next = "";
  let cursor = 0;
  for (const range of removedRanges) {
    next += markdown.slice(cursor, range.from);
    cursor = range.to;
  }
  next += markdown.slice(cursor);
  return { markdown: next, removedRanges };
}

function adjustPosition(position: number, removedRanges: Array<{ from: number; to: number }>) {
  let offset = 0;
  for (const range of removedRanges) {
    if (range.to <= position) {
      offset += range.to - range.from;
      continue;
    }
    if (range.from < position && position < range.to) {
      return range.from - offset;
    }
  }
  return position - offset;
}
