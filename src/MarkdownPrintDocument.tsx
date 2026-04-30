import type { ReactNode } from "react";

type MarkdownPrintDocumentProps = {
  markdown: string;
};

type TableAlign = "left" | "center" | "right" | null;

export function MarkdownPrintDocument({ markdown }: MarkdownPrintDocumentProps) {
  return <div className="printMarkdown">{renderBlocks(stripHtmlComments(markdown))}</div>;
}

function stripHtmlComments(markdown: string) {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

function renderBlocks(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\S*)?.*$/);
    if (fence) {
      const language = (fence[1] ?? "").toLowerCase();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const className = language === "mermaid" || language === "mmd" ? "printMermaidBlock" : "printCodeBlock";
      blocks.push(
        <pre className={className} key={key++}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(renderHeading(level, heading[2], key++));
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push(<hr key={key++} />);
      index += 1;
      continue;
    }

    const table = parseTable(lines, index);
    if (table) {
      blocks.push(renderTable(table.rows, table.alignments, key++));
      index = table.nextIndex;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={key++}>{renderBlocks(quoteLines.join("\n"))}</blockquote>);
      continue;
    }

    const list = parseList(lines, index);
    if (list) {
      blocks.push(renderList(list.items, list.ordered, key++));
      index = list.nextIndex;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (
        /^```/.test(lines[index]) ||
        /^(#{1,6})\s+/.test(lines[index]) ||
        /^\s{0,3}(?:---|\*\*\*|___)\s*$/.test(lines[index]) ||
        /^\s*>\s?/.test(lines[index]) ||
        /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(lines[index]) ||
        parseTable(lines, index)
      ) {
        break;
      }
      paragraph.push(lines[index]);
      index += 1;
    }

    if (paragraph.length > 0) {
      blocks.push(<p key={key++}>{renderInline(paragraph.join(" "))}</p>);
    } else {
      index += 1;
    }
  }

  return blocks;
}

function parseTable(lines: string[], index: number) {
  if (index + 1 >= lines.length || !isTableRow(lines[index]) || !isTableSeparator(lines[index + 1])) {
    return null;
  }

  const rows = [splitTableRow(lines[index])];
  const alignments = splitTableRow(lines[index + 1]).map(parseAlignment);
  let nextIndex = index + 2;
  while (nextIndex < lines.length && isTableRow(lines[nextIndex])) {
    rows.push(splitTableRow(lines[nextIndex]));
    nextIndex += 1;
  }

  return { rows, alignments, nextIndex };
}

function renderTable(rows: string[][], alignments: TableAlign[], key: number) {
  const [header, ...body] = rows;
  const marker = header[0]?.trim().toLowerCase();
  return (
    <div className="cm-md-table-wrapper" key={key}>
      <table
        className="cm-md-table"
        data-print-table={marker === "tail" ? "tail" : undefined}
        data-print-check={marker === "distant" ? "distant" : undefined}
      >
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th style={textAlignStyle(alignments[index])} key={index}>
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {header.map((_, cellIndex) => (
                <td style={textAlignStyle(alignments[cellIndex])} key={cellIndex}>
                  {renderInline(row[cellIndex] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderHeading(level: number, content: string, key: number) {
  if (level === 1) return <h1 key={key}>{renderInline(content)}</h1>;
  if (level === 2) return <h2 key={key}>{renderInline(content)}</h2>;
  if (level === 3) return <h3 key={key}>{renderInline(content)}</h3>;
  if (level === 4) return <h4 key={key}>{renderInline(content)}</h4>;
  if (level === 5) return <h5 key={key}>{renderInline(content)}</h5>;
  return <h6 key={key}>{renderInline(content)}</h6>;
}

function parseList(lines: string[], index: number) {
  const first = lines[index].match(/^\s*(?:([-*+])|(\d+)\.)\s+(.*)$/);
  if (!first) {
    return null;
  }
  const ordered = Boolean(first[2]);
  const items: string[] = [];
  let nextIndex = index;

  while (nextIndex < lines.length) {
    const match = lines[nextIndex].match(/^\s*(?:([-*+])|(\d+)\.)\s+(.*)$/);
    if (!match || Boolean(match[2]) !== ordered) {
      break;
    }
    items.push(match[3]);
    nextIndex += 1;
  }

  return { ordered, items, nextIndex };
}

function renderList(items: string[], ordered: boolean, key: number) {
  const ListTag = ordered ? "ol" : "ul";
  return (
    <ListTag key={key}>
      {items.map((item, index) => {
        const task = item.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          return (
            <li className="printTaskItem" key={index}>
              <input type="checkbox" checked={task[1].toLowerCase() === "x"} readOnly />
              <span>{renderInline(task[2])}</span>
            </li>
          );
        }
        return <li key={index}>{renderInline(item)}</li>;
      })}
    </ListTag>
  );
}

function renderInline(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = source;
  let key = 0;

  while (rest.length > 0) {
    const match = findNextInline(rest);
    if (!match) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) {
      nodes.push(rest.slice(0, match.index));
    }
    const { token, content, href } = match;
    if (token === "`") {
      nodes.push(<code key={key++}>{content}</code>);
    } else if (token === "link") {
      nodes.push(
        <a href={href ?? ""} key={key++}>
          {renderInline(content)}
        </a>,
      );
    } else if (token === "**") {
      nodes.push(<strong key={key++}>{renderInline(content)}</strong>);
    } else if (token === "*") {
      nodes.push(<em key={key++}>{renderInline(content)}</em>);
    } else if (token === "~~") {
      nodes.push(
        <span className="cm-md-strike" key={key++}>
          {renderInline(content)}
        </span>,
      );
    } else if (token === "u") {
      nodes.push(
        <span className="cm-md-underline" key={key++}>
          {renderInline(content)}
        </span>,
      );
    }
    rest = rest.slice(match.index + match.match[0].length);
  }

  return nodes;
}

function findNextInline(source: string) {
  const patterns: Array<{ token: string; regex: RegExp; hrefGroup?: number }> = [
    { token: "`", regex: /`([^`\n]+)`/ },
    { token: "link", regex: /\[([^\]\n]+)\]\(([^)\n]+)\)/, hrefGroup: 2 },
    { token: "**", regex: /\*\*([^*\n]+)\*\*/ },
    { token: "~~", regex: /~~([^~\n]+)~~/ },
    { token: "u", regex: /<u>([\s\S]*?)<\/u>/ },
    { token: "*", regex: /\*([^*\n]+)\*/ },
  ];
  let best: { index: number; match: RegExpMatchArray; token: string; content: string; href?: string } | null = null;
  for (const pattern of patterns) {
    const match = source.match(pattern.regex);
    if (!match || match.index === undefined) {
      continue;
    }
    if (!best || match.index < best.index) {
      best = {
        index: match.index,
        match,
        token: pattern.token,
        content: match[1],
        href: pattern.hrefGroup ? match[pattern.hrefGroup] : undefined,
      };
    }
  }
  return best;
}

function isTableRow(line: string) {
  return /^\|.*\|\s*$/.test(line);
}

function isTableSeparator(line: string) {
  return /^\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(line);
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
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
  return left ? "left" : null;
}

function textAlignStyle(align: TableAlign) {
  return align ? { textAlign: align } : undefined;
}
