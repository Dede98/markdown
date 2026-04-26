import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Line, type Range, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";

type TableAlign = "left" | "center" | "right" | null;

type TableBlock = {
  firstLine: Line;
  lastLine: Line;
  // [header, ...body]; the separator row is consumed for `alignments`.
  rows: string[][];
  alignments: TableAlign[];
};

// Look up `[line.from, line.to]` in the Lezer tree to determine whether
// this source line sits inside a fenced code block, and if so, which
// part. The opener (` ```js `) and closer (` ``` `) share the same
// `cm-md-code-fence` line decoration; body lines get `cm-md-code-line`
// plus the JS/TS tokenizer pass via `decorateCodeLine`. Returns `null`
// for lines that are not inside any FencedCode node (the common case).
//
// Detection walks `tree.resolveInner(line.from, 1)` upward — the deepest
// node at the line's start position is wrapped by FencedCode if and
// only if the line is part of a fence. The `language` value is read
// from the optional `CodeInfo` child of the same FencedCode node so
// the JS tokenizer fires only for `js` / `ts` info strings.
type FencedCodeContext = { role: "opener" | "closer" | "body"; language: string | null };

function getFencedCodeContext(state: EditorState, line: Line): FencedCodeContext | null {
  const tree = syntaxTree(state);
  let fence: SyntaxNode | null = tree.resolveInner(line.from, 1);
  while (fence && fence.name !== "FencedCode") {
    fence = fence.parent;
  }
  if (!fence) {
    return null;
  }

  // Collect the fence's CodeMark + CodeInfo children. The first CodeMark
  // is the opener and the last is the closer; an unterminated fence has
  // only one CodeMark and no closer.
  let openerMark: SyntaxNode | null = null;
  let closerMark: SyntaxNode | null = null;
  let codeInfo: SyntaxNode | null = null;
  let child = fence.firstChild;
  while (child) {
    if (child.name === "CodeMark") {
      if (!openerMark) {
        openerMark = child;
      }
      closerMark = child;
    } else if (child.name === "CodeInfo") {
      codeInfo = child;
    }
    child = child.nextSibling;
  }

  const language = codeInfo ? state.sliceDoc(codeInfo.from, codeInfo.to).toLowerCase() : null;

  let role: "opener" | "closer" | "body" = "body";
  if (openerMark && line.from <= openerMark.to) {
    role = "opener";
  } else if (closerMark && closerMark !== openerMark && line.from >= closerMark.from) {
    role = "closer";
  }

  return { role, language };
}

// Lighter variant of `getFencedCodeContext` for callers that only need a
// boolean "is this line inside a fence". Walks up from `line.from` and
// short-circuits on the first `FencedCode` ancestor instead of collecting
// `CodeMark` / `CodeInfo` children. Both `tableBlockState` and
// `htmlCommentBlockState` use this to suppress their block decorations
// inside fenced code without needing role / language metadata.
function isLineInsideFencedCode(state: EditorState, line: Line): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, 1);
  while (node) {
    if (node.name === "FencedCode") {
      return true;
    }
    node = node.parent;
  }
  return false;
}

// Returns true when `pos` is inside a Lezer-recognised HTML comment node
// (`Comment` or `CommentBlock`). Used to seed the per-line `<!--` / `-->`
// scanner at the start of each visible range so an unterminated comment
// that began above the viewport keeps hiding its body when the visible
// range opens mid-comment.
//
// Known gap: Lezer's inline `Comment` node only matches single-line
// `<!-- ... -->` runs, and `CommentBlock` only fires for top-level (not
// paragraph-embedded) comments. A multi-line comment embedded inside a
// paragraph (`prose <!-- a\nb --> prose`) is therefore not tagged, so a
// visible range opening mid-comment in that exact shape would seed
// false. The per-line indexOf scan still tracks open/close transitions
// inside the visible range, so any comment that opens AND closes within
// the viewport renders correctly. This is the only known regression
// vs the prior `lineContextField` precompute and is not exercised by
// the e2e suite.
function isPositionInHtmlComment(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(pos, 1);
  while (node) {
    if (node.name === "Comment" || node.name === "CommentBlock") {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    let position = from;
    // The HTML comment scan is the only piece of multi-line state still
    // tracked by this loop. Seed `inHtmlComment` from the Lezer tree: if
    // the visible range opens inside a `Comment` / `CommentBlock` node,
    // the per-line `<!--` / `-->` walker must start in the open state so
    // an unterminated comment that began above the viewport is still
    // hidden on the first visible line.
    let inHtmlComment = isPositionInHtmlComment(view.state, from);

    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      const text = line.text;
      const tableRow = /^\|.*\|\s*$/.test(text);
      const tableSeparator = /^\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(text);
      const fenceCtx = getFencedCodeContext(view.state, line);
      const lineActive = isLineActive(view, line.from, line.to);
      const blockKind: BlockLineKind = fenceCtx ? null : classifyBlockLine(view.state, line);

      if (fenceCtx && fenceCtx.role === "body") {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-code-line" }));
        decorateCodeLine(decorations, line, fenceCtx.language);
        if (line.to + 1 > to) {
          break;
        }
        position = line.to + 1;
        continue;
      }

      if (fenceCtx) {
        // Opener (` ```js `) and closer (` ``` `) lines share the same
        // line decoration; the language is derived from the FencedCode
        // node's CodeInfo child via `fenceCtx.language`. Off-cursor we
        // collapse the entire fence line so only the rendered code body
        // is visible.
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-code-fence" }));
        if (!lineActive) {
          addDecoration(decorations, line.from, line.to, Decoration.replace({}));
        }
        if (line.to + 1 > to) {
          break;
        }
        position = line.to + 1;
        continue;
      }

      // HTML comments: walk the line to find every `<!--` / `-->` range and
      // carry an "open across newlines" flag. A line whose content is entirely
      // inside a comment is hidden via line-range replace (off-cursor) or
      // dimmed via `cm-md-syntax` (on-cursor); partial comments decorate the
      // matched span and fall through to normal markdown processing for the
      // surrounding text.
      const commentRanges: Array<{ from: number; to: number }> = [];
      {
        let scanPos = 0;
        let openInProgress: boolean = inHtmlComment;
        while (scanPos <= text.length) {
          if (openInProgress) {
            const closeIdx = text.indexOf("-->", scanPos);
            if (closeIdx === -1) {
              commentRanges.push({ from: scanPos, to: text.length });
              break;
            }
            commentRanges.push({ from: scanPos, to: closeIdx + 3 });
            scanPos = closeIdx + 3;
            openInProgress = false;
          } else {
            const openIdx = text.indexOf("<!--", scanPos);
            if (openIdx === -1) {
              break;
            }
            scanPos = openIdx;
            openInProgress = true;
          }
        }
        inHtmlComment = openInProgress;
      }

      if (commentRanges.length > 0) {
        const first = commentRanges[0];
        const last = commentRanges[commentRanges.length - 1];
        // "Full" means the comment range(s) cover the entire visible line.
        // For the multi-line interior case, an empty line still counts so the
        // empty line is treated as fully-comment (no markdown processing).
        const fullyComment =
          first.from === 0 && (last.to >= text.length || text.length === 0);

        if (fullyComment) {
          // Fully-comment lines collapse via the `htmlCommentBlockState`
          // StateField (block-level replace). Block decorations cannot live
          // in a ViewPlugin, so the only thing this branch does is skip the
          // rest of the per-line markdown processing and advance.
          if (line.to + 1 > to) {
            break;
          }
          position = line.to + 1;
          continue;
        }

        // Partial-comment line: hide the comment span via inline replace.
        // Falling through to the markdown branches would let bold / italic /
        // link emit their own `Decoration.replace` ranges that overlap the
        // comment replace, which CodeMirror rejects (the exact failure class
        // that broke the prior attempt). Surrounding prose therefore renders
        // as plain text on a comment line — comments are always invisible,
        // independent of cursor position.
        for (const range of commentRanges) {
          const fromAbs = line.from + range.from;
          const toAbs = line.from + range.to;
          if (fromAbs >= toAbs) {
            continue;
          }
          addDecoration(decorations, fromAbs, toAbs, Decoration.replace({}));
        }
        if (line.to + 1 > to) {
          break;
        }
        position = line.to + 1;
        continue;
      }

      // Line-level block decorations (heading, list bullet, task marker,
      // ordered marker, blockquote prefix, horizontal rule) come from the
      // Lezer tree. `classifyBlockLine` resolves once per line by looking
      // at marker children (HeaderMark, ListMark, TaskMarker, QuoteMark)
      // and the HorizontalRule node. The result drives a single switch
      // here, replacing the prior chain of regex matches.
      if (blockKind && blockKind.kind === "heading") {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: `cm-md-heading cm-md-heading-${blockKind.level}` }));
        decorateSyntax(decorations, line.from, blockKind.markerEnd, lineActive);
      } else if (blockKind && blockKind.kind === "task") {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-list cm-md-task-list" }));
        decorateSyntax(
          decorations,
          line.from,
          blockKind.markerEnd,
          lineActive,
          "cm-md-syntax cm-md-task-marker",
          new TaskMarkerWidget(blockKind.checked, line.from, blockKind.markerEnd),
        );
      } else if (blockKind && blockKind.kind === "bullet") {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-list" }));
        decorateSyntax(decorations, line.from, blockKind.markerEnd, lineActive, "cm-md-syntax cm-md-list-marker", new BulletMarkerWidget());
      } else if (blockKind && blockKind.kind === "ordered") {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-list" }));
        addDecoration(decorations, line.from, blockKind.markerEnd, Decoration.mark({ class: "cm-md-syntax cm-md-list-marker" }));
      }

      // Inline markdown decorations (bold, italic, inline code, strikethrough,
      // link) are driven from the Lezer syntax tree. Walking the tree per
      // visible line is bounded by `[line.from, line.to]`; the parser only
      // produces these inline nodes inside paragraph-like content, so fence
      // bodies and HTML comment lines (which already early-continue above)
      // never reach this branch. `<u>...</u>` has no Lezer node and is still
      // matched by regex below.
      syntaxTree(view.state).iterate({
        from: line.from,
        to: line.to,
        enter: (node) => {
          switch (node.name) {
            case "StrongEmphasis":
              decorateInlineSpan(decorations, view, node.from, node.to, 2, "cm-md-bold");
              return;
            case "Emphasis":
              decorateInlineSpan(decorations, view, node.from, node.to, 1, "cm-md-italic");
              return;
            case "InlineCode":
              decorateInlineSpan(decorations, view, node.from, node.to, 1, "cm-md-inline-code");
              return;
            case "Strikethrough":
              decorateInlineSpan(decorations, view, node.from, node.to, 2, "cm-md-strike");
              return;
            case "Link":
              decorateLinkNode(decorations, view, node);
              // Link children (LinkMark / URL) are handled inside; skip the
              // default child walk so we don't double-decorate the URL span.
              return false;
            default:
              return;
          }
        },
      });

      // HTML underline `<u>…</u>`. Markdown has no native underline syntax, so
      // the `<u>` tag is the de-facto convention. The opening tag is 3 chars
      // and the closing is 4; otherwise this mirrors the strike branch above.
      for (const match of text.matchAll(/<u>([^<\n]+)<\/u>/g)) {
        const start = line.from + match.index!;
        const activeSyntax = isRangeActive(view, start, start + match[0].length);
        decorateSyntax(decorations, start, start + 3, activeSyntax);
        addDecoration(decorations, start + 3, start + match[0].length - 4, Decoration.mark({ class: "cm-md-underline" }));
        decorateSyntax(decorations, start + match[0].length - 4, start + match[0].length, activeSyntax);
      }

      if (blockKind && blockKind.kind === "quote") {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-quote" }));
        decorateSyntax(decorations, line.from, blockKind.markerEnd, lineActive);
      }

      if (blockKind && blockKind.kind === "rule") {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-rule" }));
        if (lineActive) {
          addDecoration(decorations, line.from, line.to, Decoration.mark({ class: "cm-md-syntax" }));
        } else {
          addDecoration(decorations, line.from, line.to, Decoration.replace({ widget: new RuleWidget() }));
        }
      }

      // GFM tables, source mode: decorate any pipe-bordered line. The
      // separator row (`| --- | --- |`) gets its own class so we can hide
      // it visually when the cursor is elsewhere; the pipe syntax itself
      // fades out off-cursor. The block-level <table> widget that replaces
      // an inactive block lives in `tableBlockState` (a StateField) below,
      // because CodeMirror requires block decorations to come from a
      // state field rather than a ViewPlugin.
      if (tableRow || tableSeparator) {
        const cls = tableSeparator ? "cm-md-table-row cm-md-table-separator" : "cm-md-table-row";
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: cls }));
        if (!lineActive) {
          for (const match of text.matchAll(/\|/g)) {
            const start = line.from + match.index!;
            addDecoration(decorations, start, start + 1, Decoration.mark({ class: "cm-md-syntax cm-md-table-pipe" }));
          }
        }
      }

      if (line.to + 1 > to) {
        break;
      }
      position = line.to + 1;
    }
  }

  return Decoration.set(decorations, true);
}

function isRangeActive(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from > from && range.from < to;
    }

    return range.from < to && range.to > from;
  });
}

function isLineActive(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= from && range.from <= to;
    }

    return range.from <= to && range.to >= from;
  });
}

// Classification result for a single source line, derived from the Lezer
// tree. Each kind drives one branch of `buildDecorations`'s line-level
// switch. `markerEnd` is the absolute position right after the construct's
// leading marker (e.g. just past the `## ` of an H2, the `> ` of a
// blockquote, or the `[ ] ` of a task list item) so the caller can apply
// the existing `decorateSyntax` reveal-on-cursor pattern unchanged.
type BlockLineKind =
  | { kind: "heading"; level: number; markerEnd: number }
  | { kind: "task"; markerEnd: number; checked: boolean }
  | { kind: "bullet"; markerEnd: number }
  | { kind: "ordered"; markerEnd: number }
  | { kind: "quote"; markerEnd: number }
  | { kind: "rule" }
  | null;

// Resolve the line's block-level kind by scanning the Lezer tree for the
// first marker child whose start sits on this line. Priority mirrors the
// regex chain that came before this: task takes precedence over a plain
// bullet, list marker takes precedence over blockquote (a list item
// containing a blockquote child still classifies as a list line). Each
// branch falls through to the next when its marker is absent.
function classifyBlockLine(state: EditorState, line: Line): BlockLineKind {
  const tree = syntaxTree(state);

  let headingLevel = 0;
  let headerMarkEnd = -1;
  let listMarkEnd = -1;
  let isOrdered = false;
  let taskMarkerFrom = -1;
  let taskMarkerEnd = -1;
  let quoteMarkEnd = -1;
  let hrSeen = false;

  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      const name = node.name;
      // ATX heading: only treat as heading when the node literally starts
      // at column 0. Indented `#` lines aren't headings (they'd be code or
      // paragraph text), matching the prior `^(#{1,6})\s` behavior.
      if (name.startsWith("ATXHeading") && node.from === line.from && headingLevel === 0) {
        const lvl = Number(name.slice("ATXHeading".length));
        if (Number.isFinite(lvl) && lvl >= 1 && lvl <= 6) {
          headingLevel = lvl;
        }
      } else if (name === "HorizontalRule" && node.from === line.from) {
        hrSeen = true;
      } else if (name === "HeaderMark" && headerMarkEnd < 0) {
        headerMarkEnd = node.to;
      } else if (name === "ListMark" && listMarkEnd < 0) {
        listMarkEnd = node.to;
        // Walk up: ListMark.parent is ListItem, ListItem.parent is the
        // enclosing BulletList or OrderedList. The list type tells us
        // which marker class / widget to use.
        const listItem = node.node.parent;
        const list = listItem?.parent;
        isOrdered = list?.name === "OrderedList";
      } else if (name === "TaskMarker" && taskMarkerEnd < 0) {
        taskMarkerFrom = node.from;
        taskMarkerEnd = node.to;
      } else if (name === "QuoteMark" && quoteMarkEnd < 0) {
        quoteMarkEnd = node.to;
      }
    },
  });

  // Resolve to the highest-priority kind we found. The `+ 1` on marker
  // ends includes the single space that follows the marker character(s)
  // in the source (e.g. `## `, `> `, `- `, `1. `, `[ ] `). Clamp to
  // `line.to` so we never produce a range that crosses into the next
  // line if the marker is at end-of-line with no trailing content.
  if (taskMarkerEnd >= 0) {
    const text = state.sliceDoc(taskMarkerFrom, taskMarkerEnd);
    const checked = /x/i.test(text);
    return { kind: "task", markerEnd: Math.min(taskMarkerEnd + 1, line.to), checked };
  }
  if (listMarkEnd >= 0) {
    return {
      kind: isOrdered ? "ordered" : "bullet",
      markerEnd: Math.min(listMarkEnd + 1, line.to),
    };
  }
  if (headingLevel > 0 && headerMarkEnd >= 0) {
    return { kind: "heading", level: headingLevel, markerEnd: Math.min(headerMarkEnd + 1, line.to) };
  }
  if (quoteMarkEnd >= 0) {
    return { kind: "quote", markerEnd: Math.min(quoteMarkEnd + 1, line.to) };
  }
  if (hrSeen) {
    return { kind: "rule" };
  }
  return null;
}

function decorateSyntax(decorations: Range<Decoration>[], from: number, to: number, activeSyntax: boolean, className = "cm-md-syntax", widget?: WidgetType) {
  if (from >= to) {
    return;
  }

  if (activeSyntax) {
    addDecoration(decorations, from, to, Decoration.mark({ class: className }));
    return;
  }

  addDecoration(decorations, from, to, Decoration.replace(widget ? { widget } : {}));
}

function addDecoration(decorations: Range<Decoration>[], from: number, to: number, decoration: Decoration) {
  decorations.push(decoration.range(from, to));
}

// Decorate an inline span whose marker characters (e.g. `**`, `*`, `` ` ``,
// `~~`) sit symmetrically at both ends of the node range. Mirrors the
// per-regex passes that came before this: opening marker → `cm-md-syntax`
// (mark when active, replace when inactive), inner body → `bodyClass` mark,
// closing marker → same as opening. The active toggle uses the same
// `isRangeActive` semantics as the prior implementation so the marker
// reveal-on-cursor behavior is unchanged.
function decorateInlineSpan(
  decorations: Range<Decoration>[],
  view: EditorView,
  from: number,
  to: number,
  markerLength: number,
  bodyClass: string,
) {
  if (to - from <= markerLength * 2) {
    return;
  }
  const activeSyntax = isRangeActive(view, from, to);
  decorateSyntax(decorations, from, from + markerLength, activeSyntax);
  addDecoration(decorations, from + markerLength, to - markerLength, Decoration.mark({ class: bodyClass }));
  decorateSyntax(decorations, to - markerLength, to, activeSyntax);
}

// Decorate a Lezer `Link` node: `[label](url)` with optional title. Reads
// the LinkMark and URL children to find the bracket boundaries instead of
// re-parsing the line text. Active behavior matches the previous regex
// pass: cursor inside reveals the `](` and `)` markers and shows the URL,
// cursor outside collapses `](url)` to a hidden replace.
function decorateLinkNode(
  decorations: Range<Decoration>[],
  view: EditorView,
  ref: SyntaxNodeRef,
) {
  const start = ref.from;
  const end = ref.to;

  let labelEnd = -1;
  let urlStart = -1;
  let urlEnd = -1;
  let linkMarkCount = 0;
  let child = ref.node.firstChild;
  while (child) {
    if (child.name === "LinkMark") {
      linkMarkCount += 1;
      // The second LinkMark is the closing `]` (first is `[`, third `(`,
      // fourth `)`); its `from` is the boundary between label and `](url)`.
      if (linkMarkCount === 2) {
        labelEnd = child.from;
      }
    } else if (child.name === "URL") {
      urlStart = child.from;
      urlEnd = child.to;
    }
    child = child.nextSibling;
  }

  // Defensive: malformed link with missing children — leave it as plain
  // text rather than emitting partial decorations that could overlap.
  if (labelEnd < 0 || urlStart < 0 || urlEnd < 0) {
    return;
  }

  const labelStart = start + 1; // position right after the opening `[`
  const activeSyntax = isRangeActive(view, start, end);

  decorateSyntax(decorations, start, labelStart, activeSyntax);
  addDecoration(decorations, labelStart, labelEnd, Decoration.mark({ class: "cm-md-link" }));
  if (activeSyntax) {
    addDecoration(decorations, labelEnd, urlStart, Decoration.mark({ class: "cm-md-syntax" }));
    addDecoration(decorations, urlStart, urlEnd, Decoration.mark({ class: "cm-md-link-url" }));
    addDecoration(decorations, urlEnd, end, Decoration.mark({ class: "cm-md-syntax" }));
  } else {
    addDecoration(decorations, labelEnd, end, Decoration.replace({}));
  }
}

function decorateCodeLine(decorations: Range<Decoration>[], line: { from: number; text: string }, language: string | null) {
  if (language && !["js", "jsx", "javascript", "ts", "tsx", "typescript"].includes(language)) {
    return;
  }

  const tokenPattern =
    /\/\/.*|\/\*.*?\*\/|(["'`])(?:\\.|(?!\1).)*\1|\b(?:as|async|await|break|case|catch|class|const|continue|default|else|export|extends|false|finally|for|from|function|if|import|interface|let|new|null|return|switch|throw|true|try|type|undefined|var|while)\b|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*(?=\s*\()|=>|[{}()[\].,;=]/g;

  for (const match of line.text.matchAll(tokenPattern)) {
    const text = match[0];
    const from = line.from + match.index!;
    const to = from + text.length;

    addDecoration(decorations, from, to, Decoration.mark({ class: `cm-md-code-${getCodeTokenClass(text)}` }));
  }
}

function getCodeTokenClass(token: string) {
  if (token.startsWith("//") || token.startsWith("/*")) {
    return "comment";
  }

  if (/^["'`]/.test(token)) {
    return "string";
  }

  if (/^\d/.test(token)) {
    return "number";
  }

  if (/^(?:as|async|await|break|case|catch|class|const|continue|default|else|export|extends|false|finally|for|from|function|if|import|interface|let|new|null|return|switch|throw|true|try|type|undefined|var|while)$/.test(token)) {
    return "keyword";
  }

  if (/^(?:=>|[{}()[\].,;=])$/.test(token)) {
    return "operator";
  }

  return "function";
}

class BulletMarkerWidget extends WidgetType {
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-md-bullet-widget";
    return marker;
  }
}

class TaskMarkerWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: TaskMarkerWidget) {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView) {
    const marker = document.createElement("span");
    marker.className = this.checked ? "cm-md-task-widget cm-md-task-widget-checked" : "cm-md-task-widget";
    marker.setAttribute("role", "checkbox");
    marker.setAttribute("aria-checked", String(this.checked));
    marker.tabIndex = 0;
    marker.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.toggle(view);
    });
    marker.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        this.toggle(view);
      }
    });
    return marker;
  }

  ignoreEvent() {
    return false;
  }

  private toggle(view: EditorView) {
    const text = view.state.doc.sliceString(this.from, this.to);
    const replaced = this.checked ? text.replace(/\[[xX]\]/, "[ ]") : text.replace(/\[ \]/, "[x]");

    if (replaced === text) {
      return;
    }

    view.dispatch({
      changes: { from: this.from, to: this.to, insert: replaced },
      userEvent: "input.toggle",
    });
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-md-rule-widget";
    return rule;
  }
}

const TABLE_SEPARATOR_REGEX = /^\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/;
const TABLE_ROW_REGEX = /^\|.*\|\s*$/;

// Walk forward from a candidate header line to collect a complete GFM table:
// header + separator + zero or more body rows. Returns null if the second
// line doesn't match the separator pattern (i.e. this is not really a table,
// just a one-off pipe-bordered line). The separator row is consumed for
// `alignments` and not included in `rows`.
function collectTableBlock(textBuf: Text, headerLine: Line): TableBlock | null {
  if (headerLine.number + 1 > textBuf.lines) {
    return null;
  }
  const sepLine = textBuf.line(headerLine.number + 1);
  if (!TABLE_SEPARATOR_REGEX.test(sepLine.text)) {
    return null;
  }

  const alignments = splitTableRow(sepLine.text).map(parseAlignment);
  const header = splitTableRow(headerLine.text);
  const body: string[][] = [];
  let lastLine: Line = sepLine;

  for (let n = sepLine.number + 1; n <= textBuf.lines; n += 1) {
    const candidate = textBuf.line(n);
    if (!TABLE_ROW_REGEX.test(candidate.text) || TABLE_SEPARATOR_REGEX.test(candidate.text)) {
      break;
    }
    body.push(splitTableRow(candidate.text));
    lastLine = candidate;
  }

  return {
    firstLine: headerLine,
    lastLine,
    rows: [header, ...body],
    alignments,
  };
}

function splitTableRow(text: string): string[] {
  let stripped = text.trim();
  if (stripped.startsWith("|")) {
    stripped = stripped.slice(1);
  }
  if (stripped.endsWith("|")) {
    stripped = stripped.slice(0, -1);
  }
  return stripped.split("|").map((cell) => cell.trim());
}

function parseAlignment(cell: string): TableAlign {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  if (left) {
    return "left";
  }
  return null;
}

class TableWidget extends WidgetType {
  constructor(
    private readonly rows: string[][],
    private readonly alignments: TableAlign[],
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    // Strict deep-compare. CodeMirror still keeps the DOM mounted during
    // typing because `updateDOM` below patches cells in place, leaving the
    // focused cell untouched so the contenteditable cursor is preserved.
    if (this.rows.length !== other.rows.length) {
      return false;
    }
    if (this.alignments.length !== other.alignments.length) {
      return false;
    }
    for (let i = 0; i < this.alignments.length; i += 1) {
      if (this.alignments[i] !== other.alignments[i]) {
        return false;
      }
    }
    for (let r = 0; r < this.rows.length; r += 1) {
      const a = this.rows[r];
      const b = other.rows[r];
      if (a.length !== b.length) {
        return false;
      }
      for (let c = 0; c < a.length; c += 1) {
        if (a[c] !== b[c]) {
          return false;
        }
      }
    }
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    // Block widgets must present as `display: block` so CM6's height map
    // can measure them with predictable box geometry. A bare `<table>` has
    // intrinsic `display: table`, and any margin set on the widget root
    // collapses outside the wrapper CM6 puts it in — the height map then
    // disagrees with the rendered height by ~one line, and clicks below
    // the table land one source line too low. Wrapping the table in a
    // plain `<div>` lets the wrapper own the block-level margin and gives
    // CM6 the box model it expects.
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-wrapper";
    const table = document.createElement("table");
    table.className = "cm-md-table";
    wrapper.appendChild(table);
    const colCount = this.alignments.length;
    const rowCount = this.rows.length;

    // Look up the widget's CURRENT source range via the rendered DOM. The
    // widget instance's positions go stale as the doc changes; reading them
    // from the live state on every commit keeps the dispatch correct even
    // after upstream edits have shifted the table around.
    const commitFromDOM = () => {
      const tablePos = view.posAtDOM(table);
      if (tablePos < 0) {
        return;
      }
      const line = view.state.doc.lineAt(tablePos);
      const block = collectTableBlock(view.state.doc, line);
      if (!block) {
        return;
      }

      const cells = table.querySelectorAll<HTMLTableCellElement>("th, td");
      const newRows: string[][] = [];
      let idx = 0;
      for (let r = 0; r < rowCount; r += 1) {
        const row: string[] = [];
        for (let c = 0; c < colCount; c += 1) {
          const cell = cells[idx];
          idx += 1;
          row.push(readCellSource(cell));
        }
        newRows.push(row);
      }

      const newSource = serializeTableSource(newRows, this.alignments);
      const oldSource = view.state.sliceDoc(block.firstLine.from, block.lastLine.to);
      if (oldSource === newSource) {
        return;
      }
      view.dispatch({
        changes: { from: block.firstLine.from, to: block.lastLine.to, insert: newSource },
        userEvent: "input.table",
      });
    };

    // Click on a cell swaps in a real <input> element so the user gets a
    // browser-native text field with its own selection model. CodeMirror's
    // selection handling and the input's selection handling don't fight
    // because the input is opaque to CM6 (the widget reports
    // `ignoreEvent: true` so CM6 never tries to interpret events that
    // originate inside it).
    const enterEditMode = (cell: HTMLTableCellElement) => {
      if (cell.querySelector("input")) {
        return;
      }
      const source = cell.dataset.mdSource ?? "";
      cell.replaceChildren();
      cell.classList.add("cm-md-table-cell--editing");
      const input = cell.ownerDocument.createElement("input");
      input.type = "text";
      input.value = source;
      input.spellcheck = false;
      input.className = "cm-md-table-cell-input";

      input.addEventListener("input", () => {
        cell.dataset.mdSource = normalizeCellText(input.value);
        input.value = cell.dataset.mdSource;
        commitFromDOM();
      });

      input.addEventListener("blur", () => {
        cell.classList.remove("cm-md-table-cell--editing");
        renderCellRendered(cell, cell.dataset.mdSource ?? "");
      });

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          input.blur();
        }
      });

      cell.appendChild(input);
      // Defer focus so the click that triggered edit mode doesn't end up
      // moving the caret immediately on a freshly-mounted element.
      requestAnimationFrame(() => {
        if (input.isConnected) {
          input.focus();
          input.select();
        }
      });
    };

    const onCellMouseDown = (event: MouseEvent) => {
      const cell = event.currentTarget as HTMLTableCellElement;
      if (cell.classList.contains("cm-md-table-cell--editing")) {
        return;
      }
      // Block CM6's own pointer handling and the editor's selection update;
      // we'll move focus into the input ourselves.
      event.preventDefault();
      event.stopPropagation();
      enterEditMode(cell);
    };

    const buildCell = (tag: "th" | "td", text: string, align: TableAlign) => {
      const cell = document.createElement(tag);
      cell.className = "cm-md-table-cell";
      cell.dataset.mdSource = text;
      if (align) {
        cell.style.textAlign = align;
      }
      renderCellRendered(cell, text);
      cell.addEventListener("mousedown", onCellMouseDown);
      return cell;
    };

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const header = this.rows[0] ?? [];
    for (let c = 0; c < colCount; c += 1) {
      headerRow.appendChild(buildCell("th", header[c] ?? "", this.alignments[c]));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let r = 1; r < rowCount; r += 1) {
      const tr = document.createElement("tr");
      const cells = this.rows[r];
      for (let c = 0; c < colCount; c += 1) {
        tr.appendChild(buildCell("td", cells[c] ?? "", this.alignments[c]));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    // Ask CodeMirror to remeasure right after the widget mounts. Without
    // this, CM6 keeps the height it estimated from the source-line count
    // (lines 1.6em-ish each) which can be quite a bit shorter than the
    // rendered table (cell min-height + padding + borders + margin), and
    // the height map drifts by that delta — once per widget — affecting
    // every cursor calculation downstream.
    view.requestMeasure();

    return wrapper;
  }

  // Help CM6's height map land on a value much closer to the rendered
  // table. Each visible row contributes the cell `min-height: 1.6em`
  // (1.6 * 0.95em font * 16px ≈ 24px), plus top + bottom padding of
  // 0.32em (≈ 5px each side ≈ 10px) and a border. ~36px per row plus a
  // small margin per table block keeps the estimate in the right ballpark
  // even before the measure pass runs.
  get estimatedHeight(): number {
    return this.rows.length * 36 + 12;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    // Patch the existing widget DOM in place to reflect this widget's rows.
    // The cell currently in edit mode (containing the focused <input>) is
    // intentionally left alone so the user's caret and selection inside the
    // input are preserved across the dispatch round-trip that fires on
    // every keystroke.
    if (!dom.classList.contains("cm-md-table-wrapper")) {
      return false;
    }
    const table = dom.querySelector<HTMLTableElement>("table.cm-md-table");
    if (!table) {
      return false;
    }
    const cells = table.querySelectorAll<HTMLTableCellElement>("th, td");
    const colCount = this.alignments.length;
    const rowCount = this.rows.length;
    if (cells.length !== rowCount * colCount) {
      return false;
    }
    let idx = 0;
    let touched = false;
    for (let r = 0; r < rowCount; r += 1) {
      const row = this.rows[r];
      if (row.length !== colCount) {
        return false;
      }
      for (let c = 0; c < colCount; c += 1) {
        const cell = cells[idx];
        idx += 1;
        const newSource = row[c] ?? "";
        if (cell.dataset.mdSource === newSource) {
          continue;
        }
        touched = true;
        cell.dataset.mdSource = newSource;
        const input = cell.querySelector<HTMLInputElement>("input.cm-md-table-cell-input");
        if (input) {
          // Active editor cell: only sync the input value if it really
          // diverged (e.g. external doc change while editing).
          if (input.value !== newSource) {
            input.value = newSource;
          }
          continue;
        }
        renderCellRendered(cell, newSource);
      }
    }
    if (touched) {
      // Cell content can change rendered cell height (an empty cell drops
      // back to `min-height`, a wrapped value extends taller). Force a
      // re-measure so CM6's height map keeps up with the visible widget
      // size — without this, the click-target drift compounds per table
      // as edits accumulate across the doc.
      view.requestMeasure();
    }
    return true;
  }

  // Returning `true` keeps CodeMirror from intercepting clicks and key
  // events on the widget. With `false` CM6 calls `posAtCoords` on every
  // click and dispatches a selection update at the block edge, which would
  // yank focus from the cell input the user just clicked into and push the
  // selection model into a confused state.
  ignoreEvent(): boolean {
    return true;
  }
}

function readCellSource(cell: HTMLTableCellElement | undefined): string {
  if (!cell) {
    return "";
  }
  // The cell stores its raw markdown on `data-md-source`. Reading from the
  // data attribute lets us serialize non-editing cells (which display
  // rendered HTML) without losing markdown syntax characters that wouldn't
  // survive a textContent round-trip.
  if (cell.dataset.mdSource !== undefined) {
    return cell.dataset.mdSource;
  }
  const input = cell.querySelector<HTMLInputElement>("input.cm-md-table-cell-input");
  if (input) {
    return normalizeCellText(input.value);
  }
  return normalizeCellText(cell.textContent);
}

// Inline markdown rendered for table cells. The cell holds the raw markdown
// in `dataset.mdSource` and shows this rendered HTML when not focused;
// `onCellFocus` swaps back to plain text for editing. Mirrors the inline
// patterns the main editor recognizes so a bold cell stays bold, links look
// like links, etc. — without requiring a full CM instance per cell.
const CELL_INLINE_TOKEN_RE =
  /\*\*([^*\n]+)\*\*|(?:^|[^*])\*([^*\n]+)\*|~~([^~\n]+)~~|<u>([^<\n]+)<\/u>|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\n]+)\)/g;

function renderCellRendered(cell: HTMLElement, source: string): void {
  cell.replaceChildren();
  if (!source) {
    return;
  }
  let lastIndex = 0;
  // Reset regex state because RegExp objects with the `g` flag carry it.
  CELL_INLINE_TOKEN_RE.lastIndex = 0;
  for (let match = CELL_INLINE_TOKEN_RE.exec(source); match; match = CELL_INLINE_TOKEN_RE.exec(source)) {
    const tokenStart = match.index + (match[2] !== undefined ? match[0].indexOf("*") : 0);
    if (tokenStart > lastIndex) {
      cell.appendChild(document.createTextNode(source.slice(lastIndex, tokenStart)));
    }
    if (match[1] !== undefined) {
      const el = document.createElement("strong");
      el.textContent = match[1];
      cell.appendChild(el);
    } else if (match[2] !== undefined) {
      const el = document.createElement("em");
      el.textContent = match[2];
      cell.appendChild(el);
    } else if (match[3] !== undefined) {
      const el = document.createElement("span");
      el.className = "cm-md-strike";
      el.textContent = match[3];
      cell.appendChild(el);
    } else if (match[4] !== undefined) {
      const el = document.createElement("span");
      el.className = "cm-md-underline";
      el.textContent = match[4];
      cell.appendChild(el);
    } else if (match[5] !== undefined) {
      const el = document.createElement("code");
      el.className = "cm-md-inline-code";
      el.textContent = match[5];
      cell.appendChild(el);
    } else if (match[6] !== undefined && match[7] !== undefined) {
      const el = document.createElement("a");
      el.className = "cm-md-link";
      el.textContent = match[6];
      el.setAttribute("href", match[7]);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      cell.appendChild(el);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < source.length) {
    cell.appendChild(document.createTextNode(source.slice(lastIndex)));
  }
}

function normalizeCellText(raw: string | null | undefined): string {
  if (!raw) {
    return "";
  }
  // Newlines inside a GFM cell break the row; collapse any that slip in via
  // paste into single spaces and trim surrounding whitespace.
  return raw.replace(/\s*\r?\n\s*/g, " ");
}

function serializeTableSource(rows: string[][], alignments: TableAlign[]): string {
  const renderRow = (cells: string[]) => {
    const padded = alignments.map((_, i) => (cells[i] ?? "").trim());
    return `| ${padded.join(" | ")} |`;
  };
  const renderSeparator = () =>
    `| ${alignments
      .map((a) => {
        if (a === "center") {
          return ":---:";
        }
        if (a === "left") {
          return ":---";
        }
        if (a === "right") {
          return "---:";
        }
        return "---";
      })
      .join(" | ")} |`;

  const lines: string[] = [];
  lines.push(renderRow(rows[0] ?? []));
  lines.push(renderSeparator());
  for (let r = 1; r < rows.length; r += 1) {
    lines.push(renderRow(rows[r] ?? []));
  }
  return lines.join("\n");
}

// Table blocks always render as a real `<table>` widget regardless of cursor
// position. A previous design toggled to a per-line source view when the
// cursor entered the block range, but that caused jarring layout shifts (the
// widget's rendered height differs from the source view's height) and made
// arrow-key navigation feel like the cursor was jumping. Cells are not
// directly editable; structural edits (add/delete row/column, change
// alignment) will arrive as a separate context-menu surface.
//
// Block decorations must live in a StateField because CodeMirror rejects
// them from a ViewPlugin. Per-line `cm-md-table-row` source decorations
// emitted by the ViewPlugin still apply to lines covered by the widget but
// have no visual effect — the block replace hides those lines wholesale.
function buildTableBlockDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const textBuf = state.doc;

  for (let n = 1; n <= textBuf.lines; n += 1) {
    const line = textBuf.line(n);
    const lineText = line.text;

    // Skip lines covered by a `FencedCode` Lezer node so a `|`-shaped
    // line inside fenced code never collapses into a table widget. The
    // ViewPlugin path uses the same tree-driven detection via
    // `getFencedCodeContext`; this StateField now matches it.
    if (isLineInsideFencedCode(state, line)) {
      continue;
    }

    if (!TABLE_ROW_REGEX.test(lineText) || TABLE_SEPARATOR_REGEX.test(lineText)) {
      continue;
    }

    const block = collectTableBlock(textBuf, line);
    if (!block) {
      continue;
    }

    decorations.push(
      Decoration.replace({
        widget: new TableWidget(block.rows, block.alignments),
        block: true,
      }).range(block.firstLine.from, block.lastLine.to),
    );
    n = block.lastLine.number;
  }

  return Decoration.set(decorations, true);
}

export const tableBlockState = StateField.define<DecorationSet>({
  create: (state) => buildTableBlockDecorations(state),
  // Selection-only changes can't affect the widget output anymore (no cursor
  // toggle), so skip rebuild on `tr.selection` for free perf.
  update: (value, tr) => {
    if (tr.docChanged) {
      return buildTableBlockDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// HTML comments fully collapse: any line that is entirely covered by one or
// more `<!-- … -->` ranges (single-line, multi-line interior, multi-line
// open, or multi-line close) is replaced with a block-level decoration so
// the line disappears from layout entirely — no empty placeholder remains.
// Lives in a StateField because block-level replacements cannot come from a
// ViewPlugin. Comments are always invisible regardless of cursor position;
// a future "raw markdown" mode will expose them for editing.
function buildHtmlCommentBlockDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const textBuf = state.doc;
  let inHtmlComment = false;

  for (let n = 1; n <= textBuf.lines; n += 1) {
    const line = textBuf.line(n);
    const text = line.text;

    // Lines inside a `FencedCode` node never collapse: `<!-- -->` inside
    // fenced code is part of the code sample, not a hidden comment. The
    // outer `inHtmlComment` accumulator is preserved across the skipped
    // fence span — a comment that opens before a fence and closes after
    // continues to hide its body lines around the fence.
    if (isLineInsideFencedCode(state, line)) {
      continue;
    }

    const ranges: Array<{ from: number; to: number }> = [];
    let scanPos = 0;
    let openInProgress: boolean = inHtmlComment;
    while (scanPos <= text.length) {
      if (openInProgress) {
        const closeIdx = text.indexOf("-->", scanPos);
        if (closeIdx === -1) {
          ranges.push({ from: scanPos, to: text.length });
          break;
        }
        ranges.push({ from: scanPos, to: closeIdx + 3 });
        scanPos = closeIdx + 3;
        openInProgress = false;
      } else {
        const openIdx = text.indexOf("<!--", scanPos);
        if (openIdx === -1) {
          break;
        }
        scanPos = openIdx;
        openInProgress = true;
      }
    }
    inHtmlComment = openInProgress;

    if (ranges.length === 0) {
      continue;
    }

    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    const fullyComment =
      first.from === 0 && (last.to >= text.length || text.length === 0);
    if (!fullyComment) {
      continue;
    }

    // Span the line including its trailing newline so the line disappears
    // from layout. For the last line of the doc there is no trailing
    // newline; clamp to doc length to keep the range valid.
    const fromAbs = line.from;
    const toAbs = Math.min(line.to + 1, textBuf.length);
    decorations.push(
      Decoration.replace({ block: true }).range(fromAbs, toAbs),
    );
  }

  return Decoration.set(decorations, true);
}

export const htmlCommentBlockState = StateField.define<DecorationSet>({
  create: (state) => buildHtmlCommentBlockDecorations(state),
  update: (value, tr) => {
    if (tr.docChanged) {
      return buildHtmlCommentBlockDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const markdownPreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);
