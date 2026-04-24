import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    let position = from;

    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      const text = line.text;
      const heading = text.match(/^(#{1,3})\s/);

      if (heading) {
        builder.add(line.from, line.from, Decoration.line({ class: `cm-md-heading cm-md-heading-${heading[1].length}` }));
        builder.add(line.from, line.from + heading[0].length, Decoration.mark({ class: "cm-md-syntax" }));
      }

      for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
        const start = line.from + match.index!;
        builder.add(start, start + 2, Decoration.mark({ class: "cm-md-syntax" }));
        builder.add(start + 2, start + match[0].length - 2, Decoration.mark({ class: "cm-md-bold" }));
        builder.add(start + match[0].length - 2, start + match[0].length, Decoration.mark({ class: "cm-md-syntax" }));
      }

      for (const match of text.matchAll(/(^|[^*])\*([^*\n]+)\*/g)) {
        const markerOffset = match[1].length;
        const start = line.from + match.index! + markerOffset;
        builder.add(start, start + 1, Decoration.mark({ class: "cm-md-syntax" }));
        builder.add(start + 1, start + match[0].length - markerOffset - 1, Decoration.mark({ class: "cm-md-italic" }));
        builder.add(start + match[0].length - markerOffset - 1, start + match[0].length - markerOffset, Decoration.mark({ class: "cm-md-syntax" }));
      }

      for (const match of text.matchAll(/`([^`\n]+)`/g)) {
        const start = line.from + match.index!;
        builder.add(start, start + 1, Decoration.mark({ class: "cm-md-syntax" }));
        builder.add(start + 1, start + match[0].length - 1, Decoration.mark({ class: "cm-md-inline-code" }));
        builder.add(start + match[0].length - 1, start + match[0].length, Decoration.mark({ class: "cm-md-syntax" }));
      }

      if (/^>\s/.test(text)) {
        builder.add(line.from, line.from, Decoration.line({ class: "cm-md-quote" }));
        builder.add(line.from, line.from + 2, Decoration.mark({ class: "cm-md-syntax" }));
      }

      if (/^```/.test(text)) {
        builder.add(line.from, line.from, Decoration.line({ class: "cm-md-code-fence" }));
      }

      if (line.to + 1 > to) {
        break;
      }
      position = line.to + 1;
    }
  }

  return builder.finish();
}

export const markdownPreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);
