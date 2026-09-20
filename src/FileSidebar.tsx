import { ChevronDown, ChevronRight, FilePlus, FileText, Folder, FolderOpen, FolderPlus, FolderInput, PanelLeftClose, Link2, Pencil, Trash2, X } from "lucide-react";
import type { ChangeEvent, MouseEvent } from "react";
import "./fileSidebar.css";

export type FileSidebarFile = { id: string; name: string; dirty: boolean; location?: string; folderId?: string | null; open?: boolean; recoveryStatus?: string; canReconnect?: boolean };
export type FileSidebarFolder = { id: string; name: string; collapsed: boolean };

type FileSidebarProps = {
  files: ReadonlyArray<FileSidebarFile>;
  folders?: ReadonlyArray<FileSidebarFolder>;
  activeId: string | null;
  onNew: (folderId?: string) => void;
  onOpen: (folderId?: string) => void;
  onNewFolder?: () => void;
  onRenameFolder?: (id: string) => void;
  onToggleFolder?: (id: string) => void;
  onRemoveFolder?: (id: string) => void;
  onMoveFile?: (fileId: string, folderId: string | null) => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReconnect?: (id: string) => void;
  onHide: () => void;
  disabled?: boolean;
};

export function FileSidebar({ files, folders = [], activeId, onNew, onOpen, onNewFolder, onRenameFolder, onToggleFolder, onRemoveFolder, onMoveFile, onSelect, onClose, onReconnect, onHide, disabled = false }: FileSidebarProps) {
  const closeFile = (event: MouseEvent<HTMLButtonElement>, id: string) => { event.stopPropagation(); onClose(id); };

  const renderFile = (file: FileSidebarFile, index: number) => {
    const active = file.id === activeId;
    const dirtySuffix = file.dirty ? ", unsaved changes" : "";
    const action = file.open === false ? "Reopen" : "Select";
    const locationId = file.location ? `file-sidebar-location-${index}` : undefined;
    return (
      <li className={`fileSidebarItem${active ? " isActive" : ""}${file.dirty ? " isDirty" : ""}${file.open === false ? " isClosed" : ""}`} data-dirty={file.dirty ? "true" : undefined} key={file.id}>
        <button className="fileSidebarSelect" type="button" aria-current={active ? "page" : undefined} aria-label={`${action} ${file.name}${dirtySuffix}`} aria-describedby={locationId} title={file.location ? `${file.name} — ${file.location}` : file.name} onClick={() => onSelect(file.id)} disabled={disabled}>
          <FileText className="fileSidebarFileIcon" size={15} strokeWidth={1.65} aria-hidden="true" />
          <span className="fileSidebarLabel"><span className="fileSidebarNameLine"><span className="fileSidebarName">{file.name}</span><span className="fileSidebarDirtyDot" aria-hidden="true" /></span>{file.recoveryStatus && file.recoveryStatus !== "ready" && <span className="fileSidebarRecovery">{file.recoveryStatus === "conflict" ? "External changes" : "Reconnect needed"}</span>}{file.location && <span className="fileSidebarLocation" id={locationId}>{file.location}</span>}</span>
        </button>
        <div className="fileSidebarRowActions">
        {file.canReconnect && onReconnect && <button className="fileSidebarReconnect" type="button" aria-label={`Reconnect ${file.name}`} title="Choose this file at its new location" onClick={() => onReconnect(file.id)} disabled={disabled}><Link2 size={14} aria-hidden="true" /></button>}
        {folders.length > 0 && onMoveFile && <span className="fileSidebarMoveControl"><FolderInput size={14} aria-hidden="true" /><select className="fileSidebarMove" aria-label={`Move ${file.name}`} value={file.folderId ?? ""} onChange={(event: ChangeEvent<HTMLSelectElement>) => onMoveFile(file.id, event.target.value || null)} disabled={disabled}><option value="">Ungrouped</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></span>}
        {file.open !== false && <button className="fileSidebarClose" type="button" aria-label={`Close ${file.name}`} title={`Close ${file.name}`} onClick={(event) => closeFile(event, file.id)} disabled={disabled}><X size={14} strokeWidth={1.8} aria-hidden="true" /></button>}
        </div>
      </li>
    );
  };

  const renderFolder = (folder: FileSidebarFolder) => {
    const folderFiles = files.filter((file) => file.folderId === folder.id);
    return <section className="fileSidebarFolder" key={folder.id} aria-label={`${folder.name} folder`}>
      <div className="fileSidebarFolderHeader">
        <button className="fileSidebarFolderToggle" type="button" onClick={() => onToggleFolder?.(folder.id)} disabled={disabled} aria-expanded={!folder.collapsed} aria-label={`${folder.collapsed ? "Expand" : "Collapse"} ${folder.name}`}>{folder.collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}<Folder size={14} aria-hidden="true" /><span>{folder.name}</span></button>
        <div className="fileSidebarFolderActions" aria-label={`${folder.name} actions`}>
          <button type="button" aria-label={`New file in ${folder.name}`} title="New file" onClick={() => onNew(folder.id)} disabled={disabled}><FilePlus size={14} aria-hidden="true" /></button>
          <button type="button" aria-label={`Add existing files to ${folder.name}`} title="Add existing files" onClick={() => onOpen(folder.id)} disabled={disabled}><FolderOpen size={14} aria-hidden="true" /></button>
          <button type="button" aria-label={`Rename ${folder.name}`} title="Rename folder" onClick={() => onRenameFolder?.(folder.id)} disabled={disabled}><Pencil size={13} aria-hidden="true" /></button>
          <button type="button" aria-label={`Remove ${folder.name}`} title="Remove folder" onClick={() => onRemoveFolder?.(folder.id)} disabled={disabled}><Trash2 size={13} aria-hidden="true" /></button>
        </div>
      </div>
      {!folder.collapsed && <ul className="fileSidebarList" aria-label={`${folderFiles.length} files in ${folder.name}`}>{folderFiles.map((file) => renderFile(file, files.indexOf(file)))}</ul>}
    </section>;
  };

  const ungrouped = files.filter((file) => !file.folderId);
  return <nav className="fileSidebar" aria-label="Open files" aria-disabled={disabled || undefined} title={disabled ? "Leave the collaboration room to change local files" : undefined}>
    <div className="fileSidebarHeader"><h2>Files</h2><div className="fileSidebarActions" aria-label="File actions">
      <button className="fileSidebarAction" type="button" aria-label="New file" title="New file" onClick={() => onNew()} disabled={disabled}><FilePlus size={15} aria-hidden="true" /><span>New</span></button>
      <button className="fileSidebarAction" type="button" aria-label="Open file" title="Open file" onClick={() => onOpen()} disabled={disabled}><FolderOpen size={15} aria-hidden="true" /><span>Open</span></button>
      {onNewFolder && <button className="fileSidebarAction" type="button" aria-label="New folder" title="New folder" onClick={onNewFolder} disabled={disabled}><FolderPlus size={15} aria-hidden="true" /><span>Folder</span></button>}
      <button className="fileSidebarHide" type="button" aria-label="Hide file sidebar" title="Hide file sidebar" onClick={onHide}><PanelLeftClose size={16} aria-hidden="true" /></button>
    </div></div>
    {files.length === 0 && folders.length === 0 ? <div className="fileSidebarEmpty"><FileText size={24} aria-hidden="true" /><p>No files open</p><span>Create a new file or open Markdown from your device.</span></div> : <div className={`fileSidebarContents${folders.length === 0 ? " isFlat" : ""}`}>
      {folders.map(renderFolder)}
      {ungrouped.length > 0 && <section className="fileSidebarFolder" aria-label="Ungrouped files">{folders.length > 0 && <div className="fileSidebarUngrouped">Ungrouped</div>}<ul className="fileSidebarList" aria-label={`${ungrouped.length} open ${ungrouped.length === 1 ? "file" : "files"}`}>{ungrouped.map((file) => renderFile(file, files.indexOf(file)))}</ul></section>}
    </div>}
  </nav>;
}
