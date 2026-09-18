import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FileSidebar } from "../../src/FileSidebar";
import "../../src/styles.css";

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";

const fixtureFiles = params.has("empty")
  ? []
  : [
      { id: "duplicate-a", name: "notes.md", dirty: false },
      { id: "duplicate-b", name: "notes.md", dirty: true },
      {
        id: "long-name",
        name: "a-very-long-markdown-filename-that-must-remain-available-to-assistive-technology.md",
        dirty: false,
      },
    ];

function Fixture() {
  const [events, setEvents] = useState<string[]>([]);
  const record = (event: string) => setEvents((current) => [...current, event]);

  return (
    <main style={{ display: "flex", height: "100vh" }}>
      <FileSidebar
        files={fixtureFiles}
        activeId={fixtureFiles.length > 0 ? "duplicate-b" : null}
        onNew={() => record("new")}
        onOpen={() => record("open")}
        onHide={() => record("hide")}
        onSelect={(id) => record(`select:${id}`)}
        onClose={(id) => record(`close:${id}`)}
      />
      <ol aria-label="Callback events">
        {events.map((event, index) => <li key={`${index}-${event}`}>{event}</li>)}
      </ol>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
