import { Check, MessageSquare, PanelRightClose, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommentParseResult, CommentThreadView } from "./types";
import { getCommentThreadViews } from "./storage";

type CommentsSidebarProps = {
  parseResult: CommentParseResult;
  selectedThreadId: string | null;
  raw: boolean;
  onSelectThread: (threadId: string) => void;
  onClose: () => void;
  onAddReply: (threadId: string, body: string) => void;
  onResolveThread: (threadId: string, resolved: boolean) => void;
};

export function CommentsSidebar({
  parseResult,
  selectedThreadId,
  raw,
  onSelectThread,
  onClose,
  onAddReply,
  onResolveThread,
}: CommentsSidebarProps) {
  const threads = useMemo(() => getCommentThreadViews(parseResult), [parseResult]);

  return (
    <aside className="commentsSidebar" aria-label="Comments">
      <div className="commentsSidebarHeader">
        <div>
          <h2>Comments</h2>
          <p>{threads.length === 0 ? "No threads" : `${threads.length} ${threads.length === 1 ? "thread" : "threads"}`}</p>
        </div>
        <button className="iconButton" type="button" title="Close comments" aria-label="Close comments" onClick={onClose}>
          <PanelRightClose size={16} />
        </button>
      </div>

      {parseResult.readOnlyReason && (
        <div className="commentsNotice commentsNoticeError" role="status">
          {parseResult.readOnlyReason}. Comments are read-only.
        </div>
      )}

      {raw && (
        <div className="commentsNotice" role="status">
          Raw mode exposes comment anchors. Editing marker text can detach a thread.
        </div>
      )}

      <div className="commentThreadList">
        {threads.length === 0 ? (
          <div className="commentsEmpty">
            <MessageSquare size={18} />
            <span>Select text and add a comment.</span>
          </div>
        ) : (
          threads.map((thread) => (
            <CommentThreadCard
              key={thread.id}
              thread={thread}
              selected={thread.id === selectedThreadId}
              readOnly={Boolean(parseResult.readOnlyReason)}
              onSelect={() => onSelectThread(thread.id)}
              onAddReply={(body) => onAddReply(thread.id, body)}
              onResolve={(resolved) => onResolveThread(thread.id, resolved)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

type CommentThreadCardProps = {
  thread: CommentThreadView;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onAddReply: (body: string) => void;
  onResolve: (resolved: boolean) => void;
};

function CommentThreadCard({
  thread,
  selected,
  readOnly,
  onSelect,
  onAddReply,
  onResolve,
}: CommentThreadCardProps) {
  const [draft, setDraft] = useState("");
  const latestReply = thread.replies[thread.replies.length - 1];
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (selected) {
      cardRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  return (
    <article
      className={[
        "commentThread",
        selected ? "isSelected" : "",
        thread.resolved ? "isResolved" : "",
      ].filter(Boolean).join(" ")}
      ref={cardRef}
    >
      <button className="commentThreadHeader" type="button" onClick={onSelect}>
        <span className="commentThreadTitle">
          {thread.resolved ? "Resolved thread" : "Open thread"}
        </span>
        {thread.orphaned && <span className="commentBadge">Detached</span>}
        {thread.anchorOnly && <span className="commentBadge">Missing metadata</span>}
      </button>

      {!selected && (
        <p className="commentThreadSummary">
          {latestReply?.body || "No replies yet."}
        </p>
      )}

      {selected && (
        <div className="commentThreadBody">
          {thread.replies.length > 0 ? (
            <div className="commentReplies">
              {thread.replies.map((reply) => (
                <div className="commentReply" key={reply.id}>
                  <div>
                    <strong>{reply.author.name || "Local User"}</strong>
                    <time>{formatTime(reply.ts)}</time>
                  </div>
                  <p>{reply.body}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="commentDraftHint">No replies yet.</p>
          )}

          <textarea
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="Reply..."
            disabled={readOnly || thread.anchorOnly}
          />

          <div className="commentThreadActions">
            <button
              type="button"
              className="commentActionButton"
              onClick={() => {
                onAddReply(draft);
                setDraft("");
              }}
              disabled={readOnly || thread.anchorOnly || draft.trim().length === 0}
            >
              Reply
            </button>
            <button
              type="button"
              className="iconButton"
              title={thread.resolved ? "Reopen thread" : "Resolve thread"}
              aria-label={thread.resolved ? "Reopen thread" : "Resolve thread"}
              onClick={() => onResolve(!thread.resolved)}
              disabled={readOnly || thread.anchorOnly}
            >
              {thread.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function formatTime(value: string) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
