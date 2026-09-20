import { FilePlus, FileText, FolderOpen, PanelLeftClose, X } from "lucide-react";
import type { MouseEvent } from "react";
import "./fileSidebar.css";

export type FileSidebarFile = {
  id: string;
  name: string;
  dirty: boolean;
  /** Optional, presentation-only context for otherwise ambiguous filenames. */
  location?: string;
};

type FileSidebarProps = {
  files: ReadonlyArray<FileSidebarFile>;
  activeId: string | null;
  onNew: () => void;
  onOpen: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onHide: () => void;
  disabled?: boolean;
};

export function FileSidebar({
  files,
  activeId,
  onNew,
  onOpen,
  onSelect,
  onClose,
  onHide,
  disabled = false,
}: FileSidebarProps) {
  const closeFile = (event: MouseEvent<HTMLButtonElement>, id: string) => {
    event.stopPropagation();
    onClose(id);
  };

  return (
    <nav
      className="fileSidebar"
      aria-label="Open files"
      aria-disabled={disabled || undefined}
      title={disabled ? "Leave the collaboration room to change local files" : undefined}
    >
      <div className="fileSidebarHeader">
        <h2>Files</h2>
        <div className="fileSidebarActions" aria-label="File actions">
          <button
            className="fileSidebarAction"
            type="button"
            aria-label="New file"
            title="New file"
            onClick={onNew}
            disabled={disabled}
          >
            <FilePlus size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>New</span>
          </button>
          <button
            className="fileSidebarAction"
            type="button"
            aria-label="Open file"
            title="Open file"
            onClick={onOpen}
            disabled={disabled}
          >
            <FolderOpen size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>Open</span>
          </button>
          <button
            className="fileSidebarHide"
            type="button"
            aria-label="Hide file sidebar"
            title="Hide file sidebar"
            onClick={onHide}
          >
            <PanelLeftClose size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="fileSidebarEmpty">
          <FileText size={24} strokeWidth={1.35} aria-hidden="true" />
          <p>No files open</p>
          <span>Create a new file or open Markdown from your device.</span>
        </div>
      ) : (
        <ul className="fileSidebarList" aria-label={`${files.length} open ${files.length === 1 ? "file" : "files"}`}>
          {files.map((file, index) => {
            const active = file.id === activeId;
            const dirtySuffix = file.dirty ? ", unsaved changes" : "";
            const locationId = file.location ? `file-sidebar-location-${index}` : undefined;

            return (
              <li
                className={`fileSidebarItem${active ? " isActive" : ""}${file.dirty ? " isDirty" : ""}`}
                data-dirty={file.dirty ? "true" : undefined}
                key={file.id}
              >
                <button
                  className="fileSidebarSelect"
                  type="button"
                  aria-current={active ? "page" : undefined}
                  aria-label={`Select ${file.name}${dirtySuffix}`}
                  aria-describedby={locationId}
                  title={file.location ? `${file.name} — ${file.location}` : file.name}
                  onClick={() => onSelect(file.id)}
                  disabled={disabled}
                >
                  <FileText className="fileSidebarFileIcon" size={15} strokeWidth={1.65} aria-hidden="true" />
                  <span className="fileSidebarLabel">
                    <span className="fileSidebarNameLine">
                      <span className="fileSidebarName">{file.name}</span>
                      <span className="fileSidebarDirtyDot" aria-hidden="true" />
                    </span>
                    {file.location && (
                      <span className="fileSidebarLocation" id={locationId}>
                        {file.location}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  className="fileSidebarClose"
                  type="button"
                  aria-label={`Close ${file.name}`}
                  title={`Close ${file.name}`}
                  onClick={(event) => closeFile(event, file.id)}
                  disabled={disabled}
                >
                  <X size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
