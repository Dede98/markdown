export type CommentAuthor = {
  name: string;
  uuid: string;
};

export type CommentReply = {
  id: string;
  author: CommentAuthor;
  ts: string;
  body: string;
};

export type CommentThread = {
  id: string;
  createdAt: string;
  resolved: boolean;
  replies: CommentReply[];
};

export type CommentAnchor = {
  id: string;
  from: number;
  to: number;
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
};

export type CommentThreadView = CommentThread & {
  anchor: CommentAnchor | null;
  orphaned: boolean;
  anchorOnly: boolean;
};

export type CommentParseResult = {
  version: string | null;
  threads: Record<string, CommentThread>;
  anchors: CommentAnchor[];
  orphanedIds: Set<string>;
  metadataBlock: { from: number; to: number; version: string; json: string } | null;
  readOnlyReason: string | null;
};
