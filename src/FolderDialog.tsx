import { useEffect, useRef, useState } from "react";

export type FolderDialogRequest =
  | { kind: "create" }
  | { kind: "rename" | "remove"; id: string; name: string };

export function FolderDialog({ request, onSubmit, onClose }: {
  request: FolderDialogRequest;
  onSubmit: (name: string) => string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [invoker] = useState(() => document.activeElement);
  const [name, setName] = useState(request.kind === "create" ? "New folder" : request.name);
  const [error, setError] = useState<string | null>(null);
  const title = request.kind === "create" ? "New folder" : request.kind === "rename" ? "Rename folder" : "Remove folder";
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.select();
    return () => {
      if (invoker instanceof HTMLElement && invoker.isConnected) invoker.focus();
      else document.querySelector<HTMLButtonElement>('[aria-label="New folder"]')?.focus();
    };
  }, []);
  return <dialog ref={dialog} className="folderDialog" aria-labelledby="folder-dialog-title" onCancel={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); const failure = onSubmit(name); if (failure) setError(failure); else onClose(); }}>
      <h2 id="folder-dialog-title">{title}</h2>
      {request.kind === "remove" ? <p>Remove “{request.name}”? Its files and drafts will remain ungrouped. Files on disk will not change.</p> :
        <label>Folder name<input ref={input} value={name} onChange={(event) => { setName(event.target.value); setError(null); }} aria-invalid={Boolean(error)} aria-describedby={error ? "folder-dialog-error" : undefined} autoFocus /></label>}
      {error && <p id="folder-dialog-error" role="alert">{error}</p>}
      <div className="folderDialogActions"><button type="button" onClick={onClose} autoFocus={request.kind === "remove"}>Cancel</button><button type="submit">{request.kind === "create" ? "Create" : request.kind === "rename" ? "Rename" : "Remove"}</button></div>
    </form>
  </dialog>;
}
