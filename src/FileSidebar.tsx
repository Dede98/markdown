import { FilePlus, FolderOpen, PanelLeftClose, X } from "lucide-react";
import type { MouseEvent } from "react";
import "./fileSidebar.css";

type FileSidebarProps = {
  files: ReadonlyArray<{ id: string; name: string; dirty: boolean }>;
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
          <button type="button" aria-label="New file" title="New file" onClick={onNew} disabled={disabled}>
            <FilePlus size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Open file" title="Open file" onClick={onOpen} disabled={disabled}>
            <FolderOpen size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Hide file sidebar"
            title="Hide file sidebar"
            onClick={onHide}
          >
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <p className="fileSidebarEmpty">No files open</p>
      ) : (
        <ul className="fileSidebarList">
          {files.map((file) => {
            const active = file.id === activeId;
            const dirtySuffix = file.dirty ? ", unsaved changes" : "";

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
                  title={file.name}
                  onClick={() => onSelect(file.id)}
                  disabled={disabled}
                >
                  <span className="fileSidebarDirtyDot" aria-hidden="true" />
                  <span className="fileSidebarName">{file.name}</span>
                </button>
                <button
                  className="fileSidebarClose"
                  type="button"
                  aria-label={`Close ${file.name}`}
                  title={`Close ${file.name}`}
                  onClick={(event) => closeFile(event, file.id)}
                  disabled={disabled}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
