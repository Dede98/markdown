import type { CommentAnchor, CommentParseResult, CommentThread, CommentThreadView } from "./types";

export const COMMENTS_VERSION = "markdown-comments-v1";

const COMMENT_BLOCK_RE = /\n*<!--\n(markdown-comments-[^\n]+)\n([\s\S]*?)\n-->\s*$/u;
const COMMENT_MARKER_RE = /<!--c:([0-9A-HJKMNP-TV-Z]{26})-->|<!--\/c:([0-9A-HJKMNP-TV-Z]{26})-->/gu;

type MetadataShape = {
  threads?: Record<string, CommentThread>;
};

export function parseComments(markdown: string): CommentParseResult {
  const metadataBlock = findMetadataBlock(markdown);
  const readOnlyReason = getReadOnlyReason(metadataBlock);
  const threads = readOnlyReason ? {} : parseMetadataThreads(metadataBlock);
  const anchorParse = parseAnchors(markdown, metadataBlock?.from ?? markdown.length);
  const orphanedIds = new Set(anchorParse.orphanedIds);

  for (const threadId of Object.keys(threads)) {
    if (!anchorParse.anchors.some((anchor) => anchor.id === threadId)) {
      orphanedIds.add(threadId);
    }
  }

  return {
    version: metadataBlock?.version ?? null,
    threads,
    anchors: anchorParse.anchors,
    orphanedIds,
    metadataBlock,
    readOnlyReason,
  };
}

export function getCommentThreadViews(parse: CommentParseResult): CommentThreadView[] {
  const views: CommentThreadView[] = [];
  const seen = new Set<string>();

  for (const thread of Object.values(parse.threads)) {
    const anchor = parse.anchors.find((candidate) => candidate.id === thread.id) ?? null;
    seen.add(thread.id);
    views.push({
      ...thread,
      anchor,
      orphaned: parse.orphanedIds.has(thread.id),
      anchorOnly: false,
    });
  }

  for (const anchor of parse.anchors) {
    if (seen.has(anchor.id)) {
      continue;
    }
    views.push({
      id: anchor.id,
      createdAt: "",
      resolved: false,
      replies: [],
      anchor,
      orphaned: true,
      anchorOnly: true,
    });
  }

  return views.sort((a, b) => {
    const aPos = a.anchor?.from ?? Number.MAX_SAFE_INTEGER;
    const bPos = b.anchor?.from ?? Number.MAX_SAFE_INTEGER;
    return aPos - bPos || a.id.localeCompare(b.id);
  });
}

export function replaceMetadataBlock(markdown: string, threads: Record<string, CommentThread>): string {
  const metadataBlock = findMetadataBlock(markdown);
  const body = metadataBlock ? markdown.slice(0, metadataBlock.from).trimEnd() : markdown.trimEnd();
  if (Object.keys(threads).length === 0) {
    return body;
  }
  const block = buildMetadataBlock(threads);
  return `${body}\n\n${block}`;
}

export function buildMetadataBlock(threads: Record<string, CommentThread>): string {
  const json = JSON.stringify({ threads });
  return `<!--\n${COMMENTS_VERSION}\n${escapeCommentJson(json)}\n-->`;
}

export function escapeCommentJson(json: string): string {
  let escaped = json.replace(/</g, "\\u003c");
  while (escaped.includes("--")) {
    escaped = escaped.replace(/--/g, "-\\u002d");
  }
  return escaped;
}

function findMetadataBlock(markdown: string): CommentParseResult["metadataBlock"] {
  const match = COMMENT_BLOCK_RE.exec(markdown);
  if (!match || match.index === undefined) {
    return null;
  }
  return {
    from: match.index,
    to: match.index + match[0].length,
    version: match[1],
    json: match[2],
  };
}

function getReadOnlyReason(metadataBlock: CommentParseResult["metadataBlock"]) {
  if (!metadataBlock) {
    return null;
  }
  if (metadataBlock.version !== COMMENTS_VERSION) {
    return `Unsupported comments format: ${metadataBlock.version}`;
  }
  try {
    JSON.parse(metadataBlock.json) as MetadataShape;
    return null;
  } catch {
    return "Comments metadata is invalid JSON";
  }
}

function parseMetadataThreads(metadataBlock: CommentParseResult["metadataBlock"]) {
  if (!metadataBlock || metadataBlock.version !== COMMENTS_VERSION) {
    return {};
  }
  try {
    const parsed = JSON.parse(metadataBlock.json) as MetadataShape;
    return sanitizeThreads(parsed.threads ?? {});
  } catch {
    return {};
  }
}

function sanitizeThreads(threads: Record<string, CommentThread>) {
  const next: Record<string, CommentThread> = {};
  for (const [id, thread] of Object.entries(threads)) {
    if (!thread || typeof thread !== "object") {
      continue;
    }
    next[id] = {
      id,
      createdAt: typeof thread.createdAt === "string" ? thread.createdAt : "",
      resolved: Boolean(thread.resolved),
      replies: Array.isArray(thread.replies) ? thread.replies : [],
    };
  }
  return next;
}

function parseAnchors(markdown: string, limit: number): { anchors: CommentAnchor[]; orphanedIds: Set<string> } {
  const anchors: CommentAnchor[] = [];
  const orphanedIds = new Set<string>();
  const openMarkers = new Map<string, { from: number; to: number }>();
  const source = markdown.slice(0, limit);
  let match: RegExpExecArray | null;

  COMMENT_MARKER_RE.lastIndex = 0;
  while ((match = COMMENT_MARKER_RE.exec(source))) {
    const openId = match[1];
    const closeId = match[2];
    if (openId) {
      if (openMarkers.has(openId)) {
        orphanedIds.add(openId);
      }
      openMarkers.set(openId, {
        from: match.index,
        to: match.index + match[0].length,
      });
      continue;
    }

    if (!closeId) {
      continue;
    }
    const opener = openMarkers.get(closeId);
    if (!opener) {
      orphanedIds.add(closeId);
      continue;
    }
    anchors.push({
      id: closeId,
      from: opener.to,
      to: match.index,
      openFrom: opener.from,
      openTo: opener.to,
      closeFrom: match.index,
      closeTo: match.index + match[0].length,
    });
    openMarkers.delete(closeId);
  }

  for (const id of openMarkers.keys()) {
    orphanedIds.add(id);
  }

  return { anchors, orphanedIds };
}
