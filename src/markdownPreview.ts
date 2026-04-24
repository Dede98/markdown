import type { Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  let inCodeFence = false;
  let codeFenceLanguage: string | null = null;

  for (const { from, to } of view.visibleRanges) {
    let position = from;

    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      const text = line.text;
      const heading = text.match(/^(#{1,3})\s/);
      const taskList = text.match(/^(\s*)[-*]\s+\[([ xX])\]\s+/);
      const unorderedList = text.match(/^(\s*)[-*]\s+/);
      const orderedList = text.match(/^(\s*)\d+[.)]\s+/);
      const fence = text.match(/^```\s*([A-Za-z0-9_-]+)?\s*$/);
      const lineActive = isLineActive(view, line.from, line.to);
      const codeLine = inCodeFence && !fence;

      if (codeLine) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-code-line" }));
        decorateCodeLine(decorations, line, codeFenceLanguage);
        if (line.to + 1 > to) {
          break;
        }
        position = line.to + 1;
        continue;
      }

      if (heading) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: `cm-md-heading cm-md-heading-${heading[1].length}` }));
        decorateSyntax(decorations, line.from, line.from + heading[0].length, lineActive);
      }

      if (taskList) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-list cm-md-task-list" }));
        decorateSyntax(decorations, line.from, line.from + taskList[0].length, lineActive, "cm-md-syntax cm-md-task-marker", new TaskMarkerWidget(taskList[2].toLowerCase() === "x"));
      } else if (unorderedList) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-list" }));
        decorateSyntax(decorations, line.from, line.from + unorderedList[0].length, lineActive, "cm-md-syntax cm-md-list-marker", new BulletMarkerWidget());
      } else if (orderedList) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-list" }));
        addDecoration(decorations, line.from, line.from + orderedList[0].length, Decoration.mark({ class: "cm-md-syntax cm-md-list-marker" }));
      }

      for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
        const start = line.from + match.index!;
        const activeSyntax = isRangeActive(view, start, start + match[0].length);
        decorateSyntax(decorations, start, start + 2, activeSyntax);
        addDecoration(decorations, start + 2, start + match[0].length - 2, Decoration.mark({ class: "cm-md-bold" }));
        decorateSyntax(decorations, start + match[0].length - 2, start + match[0].length, activeSyntax);
      }

      for (const match of text.matchAll(/(^|[^*])\*([^*\n]+)\*/g)) {
        const markerOffset = match[1].length;
        const start = line.from + match.index! + markerOffset;
        const activeSyntax = isRangeActive(view, start, start + match[0].length - markerOffset);
        decorateSyntax(decorations, start, start + 1, activeSyntax);
        addDecoration(decorations, start + 1, start + match[0].length - markerOffset - 1, Decoration.mark({ class: "cm-md-italic" }));
        decorateSyntax(decorations, start + match[0].length - markerOffset - 1, start + match[0].length - markerOffset, activeSyntax);
      }

      for (const match of text.matchAll(/`([^`\n]+)`/g)) {
        const start = line.from + match.index!;
        const activeSyntax = isRangeActive(view, start, start + match[0].length);
        decorateSyntax(decorations, start, start + 1, activeSyntax);
        addDecoration(decorations, start + 1, start + match[0].length - 1, Decoration.mark({ class: "cm-md-inline-code" }));
        decorateSyntax(decorations, start + match[0].length - 1, start + match[0].length, activeSyntax);
      }

      for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
        const start = line.from + match.index!;
        const labelStart = start + 1;
        const labelEnd = labelStart + match[1].length;
        const urlStart = labelEnd + 2;
        const urlEnd = urlStart + match[2].length;
        const activeSyntax = isRangeActive(view, start, urlEnd + 1);
        decorateSyntax(decorations, start, labelStart, activeSyntax);
        addDecoration(decorations, labelStart, labelEnd, Decoration.mark({ class: "cm-md-link" }));
        if (activeSyntax) {
          addDecoration(decorations, labelEnd, urlStart, Decoration.mark({ class: "cm-md-syntax" }));
          addDecoration(decorations, urlStart, urlEnd, Decoration.mark({ class: "cm-md-link-url" }));
          addDecoration(decorations, urlEnd, urlEnd + 1, Decoration.mark({ class: "cm-md-syntax" }));
        } else {
          addDecoration(decorations, labelEnd, urlEnd + 1, Decoration.replace({}));
        }
      }

      if (/^>\s/.test(text)) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-quote" }));
        decorateSyntax(decorations, line.from, line.from + 2, lineActive);
      }

      if (/^---+$/.test(text.trim())) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-rule" }));
        if (lineActive) {
          addDecoration(decorations, line.from, line.to, Decoration.mark({ class: "cm-md-syntax" }));
        } else {
          addDecoration(decorations, line.from, line.to, Decoration.replace({ widget: new RuleWidget() }));
        }
      }

      if (fence) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-code-fence" }));
        if (!lineActive) {
          addDecoration(decorations, line.from, line.to, Decoration.replace({}));
        }
        if (inCodeFence) {
          inCodeFence = false;
          codeFenceLanguage = null;
        } else {
          inCodeFence = true;
          codeFenceLanguage = fence[1]?.toLowerCase() ?? null;
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

function decorateCodeLine(decorations: Range<Decoration>[], line: { from: number; text: string }, language: string | null) {
  if (!language || !["js", "jsx", "javascript", "ts", "tsx", "typescript"].includes(language)) {
    return;
  }

  const tokenPattern =
    /\/\/.*|\/\*.*?\*\/|(["'`])(?:\\.|(?!\1).)*\1|\b(?:as|async|await|break|case|catch|class|const|continue|default|else|export|extends|false|finally|for|from|function|if|import|interface|let|new|null|return|switch|throw|true|try|type|undefined|var|while)\b|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*(?=\s*\()/g;

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
  constructor(private readonly checked: boolean) {
    super();
  }

  eq(other: TaskMarkerWidget) {
    return this.checked === other.checked;
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = this.checked ? "cm-md-task-widget cm-md-task-widget-checked" : "cm-md-task-widget";
    return marker;
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-md-rule-widget";
    return rule;
  }
}

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
