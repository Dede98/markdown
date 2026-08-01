import { Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ContentWidth } from "./contentWidth";
import type { MarkdownHeading } from "./headingNavigation";

type FloatingHeadingsProps = {
  headings: MarkdownHeading[];
  activeHeadingId: string | null;
  contentWidth: ContentWidth;
  onNavigate: (heading: MarkdownHeading) => void;
};

export function FloatingHeadings({
  headings,
  activeHeadingId,
  contentWidth,
  onNavigate,
}: FloatingHeadingsProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const pointerFocusRef = useRef(false);
  const panelId = useId();

  const filteredHeadings = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return headings;
    }
    return headings.filter((heading) => heading.label.toLocaleLowerCase().includes(normalized));
  }, [headings, query]);

  const baseLevel = useMemo(
    () => headings.reduce((lowest, heading) => Math.min(lowest, heading.level), 6),
    [headings],
  );

  useEffect(() => {
    if (!expanded) {
      return;
    }

    const handleOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setExpanded(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [expanded]);

  useEffect(() => {
    if (!expanded || !activeHeadingId) {
      return;
    }
    const active = listRef.current?.querySelector<HTMLElement>("[aria-current='location']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeHeadingId, expanded]);

  const railHeight = Math.min(400, Math.max(28, headings.length * 7));
  const markerStackStyle = {
    height: `${railHeight}px`,
    gridTemplateRows: `repeat(${headings.length}, minmax(1px, 1fr))`,
  } as CSSProperties;

  return (
    <div
      className={`floatingHeadings floatingHeadings${toClassSuffix(contentWidth)}${expanded ? " isExpanded" : ""}`}
      ref={containerRef}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") {
          setExpanded(true);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") {
          pointerFocusRef.current = false;
          setExpanded(false);
        }
      }}
      onFocusCapture={() => {
        if (!pointerFocusRef.current) {
          setExpanded(true);
        }
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setExpanded(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          setExpanded(false);
          railRef.current?.focus();
        }
      }}
    >
      <button
        className="floatingHeadingsRail"
        type="button"
        aria-label={expanded ? "Hide document headings" : "Show document headings"}
        aria-expanded={expanded}
        aria-controls={panelId}
        onPointerDown={() => {
          // A tap focuses the disclosure before its click fires. Suppress that
          // intermediate focus-open so the click remains a reliable toggle.
          pointerFocusRef.current = true;
        }}
        onPointerCancel={() => {
          pointerFocusRef.current = false;
        }}
        onClick={() => {
          pointerFocusRef.current = false;
          setExpanded((value) => !value);
        }}
        ref={railRef}
      >
        <span className="floatingHeadingMarkers" style={markerStackStyle} aria-hidden="true">
          {headings.map((heading) => (
            <span className="floatingHeadingMarkerRow" key={heading.id}>
              <span
                className={heading.id === activeHeadingId ? "floatingHeadingMarker isActive" : "floatingHeadingMarker"}
                style={{ "--floating-heading-marker-width": `${markerWidth(heading.level)}px` } as CSSProperties}
              />
            </span>
          ))}
        </span>
      </button>

      <nav
        className="floatingHeadingsPanel"
        id={panelId}
        aria-label="Document headings"
        aria-hidden={!expanded}
      >
        <div className="floatingHeadingsPanelHeader">
          <strong>Headings</strong>
          <label className="floatingHeadingsFilter">
            <span className="srOnly">Filter headings</span>
            <Search size={13} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Filter headings"
              tabIndex={expanded ? 0 : -1}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>

        {filteredHeadings.length > 0 ? (
          <ol className="floatingHeadingsList" ref={listRef}>
            {filteredHeadings.map((heading) => (
              <li key={heading.id}>
                <button
                  type="button"
                  title={heading.label}
                  aria-current={heading.id === activeHeadingId ? "location" : undefined}
                  tabIndex={expanded ? 0 : -1}
                  style={{ "--floating-heading-indent": `${(heading.level - baseLevel) * 12}px` } as CSSProperties}
                  onClick={() => {
                    onNavigate(heading);
                    setExpanded(false);
                  }}
                >
                  <span>{heading.label}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="floatingHeadingsEmpty">No matching headings</p>
        )}
      </nav>
    </div>
  );
}

function markerWidth(level: number) {
  return Math.max(7, 25 - level * 3);
}

function toClassSuffix(value: ContentWidth) {
  if (value === "wide") {
    return "Wide";
  }
  if (value === "full") {
    return "Full";
  }
  return "Focused";
}
