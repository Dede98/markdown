import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let inCodeFence = false;

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

      if (heading) {
        builder.add(line.from, line.from, Decoration.line({ class: `cm-md-heading cm-md-heading-${heading[1].length}` }));
        decorateSyntax(builder, line.from, line.from + heading[0].length, lineActive);
      }

      if (taskList) {
        builder.add(line.from, line.from, Decoration.line({ class: "cm-md-list cm-md-task-list" }));
        decorateSyntax(builder, line.from, line.from + taskList[0].length, lineActive, "cm-md-syntax cm-md-task-marker", new TaskMarkerWidget(taskList[2].toLowerCase() === "x"));
      } else if (unorderedList) {
        builder.add(line.from, line.from, Decoration.line({ class: "cm-md-list" }));
        decorateSyntax(builder, line.from, line.from + unorderedList[0].length, lineActive, "cm-md-syntax cm-md-list-marker", new BulletMarkerWidget());
      } else if (orderedList) {
        builder.add(line.from, line.from, Decoration.line({ class: "cm-md-list" }));
        builder.add(line.from, line.from + orderedList[0].length, Decoration.mark({ class: "cm-md-syntax cm-md-list-marker" }));
      }

      if (codeLine) {
        builder.add(line.from, line.from, Decoration.line({ class: "cm-md-code-line" }));
      }

      for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
        const start = line.from + match.index!;
        const activeSyntax = isRangeActive(view, start, start + match[0].length);
        decorateSyntax(builder, start, start + 2, activeSyntax);
        builder.add(start + 2, start + match[0].length - 2, Decoration.mark({ class: "cm-md-bold" }));
        decorateSyntax(builder, start + match[0].length - 2, start + match[0].length, activeSyntax);
      }

      for (const match of text.matchAll(/(^|[^*])\*([^*\n]+)\*/g)) {
        const markerOffset = match[1].length;
        const start = line.from + match.index! + markerOffset;
        const activeSyntax = isRangeActive(view, start, start + match[0].length - markerOffset);
        decorateSyntax(builder, start, start + 1, activeSyntax);
        builder.add(start + 1, start + match[0].length - markerOffset - 1, Decoration.mark({ class: "cm-md-italic" }));
        decorateSyntax(builder, start + match[0].length - markerOffset - 1, start + match[0].length - markerOffset, activeSyntax);
      }

      for (const match of text.matchAll(/`([^`\n]+)`/g)) {
        const start = line.from + match.index!;
        const activeSyntax = isRangeActive(view, start, start + match[0].length);
        decorateSyntax(builder, start, start + 1, activeSyntax);
        builder.add(start + 1, start + match[0].length - 1, Decoration.mark({ class: "cm-md-inline-code" }));
        decorateSyntax(builder, start + match[0].length - 1, start + match[0].length, activeSyntax);
      }

      for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
        const start = line.from + match.index!;
        const labelStart = start + 1;
        const labelEnd = labelStart + match[1].length;
        const urlStart = labelEnd + 2;
        const urlEnd = urlStart + match[2].length;
        const activeSyntax = isRangeActive(view, start, urlEnd + 1);
        decorateSyntax(builder, start, labelStart, activeSyntax);
        builder.add(labelStart, labelEnd, Decoration.mark({ class: "cm-md-link" }));
        if (activeSyntax) {
          builder.add(labelEnd, urlStart, Decoration.mark({ class: "cm-md-syntax" }));
          builder.add(urlStart, urlEnd, Decoration.mark({ class: "cm-md-link-url" }));
          builder.add(urlEnd, urlEnd + 1, Decoration.mark({ class: "cm-md-syntax" }));
        } else {
          builder.add(labelEnd, urlEnd + 1, Decoration.replace({}));
        }
      }

      if (/^>\s/.test(text)) {
        builder.add(line.from, line.from, Decoration.line({ class: "cm-md-quote" }));
        decorateSyntax(builder, line.from, line.from + 2, lineActive);
      }

      if (/^---+$/.test(text.trim())) {
        builder.add(line.from, line.from, Decoration.line({ class: "cm-md-rule" }));
        if (lineActive) {
          builder.add(line.from, line.to, Decoration.mark({ class: "cm-md-syntax" }));
        } else {
          builder.add(line.from, line.to, Decoration.replace({ widget: new RuleWidget() }));
        }
      }

      if (fence) {
        builder.add(line.from, line.from, Decoration.line({ class: "cm-md-code-fence" }));
        if (!lineActive) {
          builder.add(line.from, line.to, Decoration.replace({}));
        }
        inCodeFence = !inCodeFence;
      }

      if (line.to + 1 > to) {
        break;
      }
      position = line.to + 1;
    }
  }

  return builder.finish();
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

function decorateSyntax(builder: RangeSetBuilder<Decoration>, from: number, to: number, activeSyntax: boolean, className = "cm-md-syntax", widget?: WidgetType) {
  if (from >= to) {
    return;
  }

  if (activeSyntax) {
    builder.add(from, to, Decoration.mark({ class: className }));
    return;
  }

  builder.add(from, to, Decoration.replace(widget ? { widget } : {}));
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
