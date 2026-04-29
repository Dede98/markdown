import { Bot, Check, FileText, PanelRightClose, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { yCollab, type YAwarenessLike } from "y-codemirror.next";
import type { AppContribution, AppContributionContext } from "../appContributions";
import type { PresenceParticipant } from "../documentSession";
import { emptyFormat, type ActiveFormat } from "../editorFormat";
import type { EditorContribution } from "../editorContributions";
import { MarkdownEditor } from "../MarkdownEditor";
import type { CloudCollaborationSpikeSession } from "./session";

type CloudCollaborationContributionOptions = {
  open: boolean;
  spike: CloudCollaborationSpikeSession | null;
  onClose: () => void;
  onLeaveRoom: () => void;
};

export function createCloudCollaborationContribution({
  open,
  spike,
  onClose,
  onLeaveRoom,
}: CloudCollaborationContributionOptions): AppContribution {
  return {
    id: "cloud-collaboration",
    panels: open && spike
      ? [
          {
            id: "cloud-collaboration-spike",
            label: "Collaboration spike",
            placement: "right",
            render: (context) => (
              <CloudCollaborationPanel
                context={context}
                spike={spike}
                onClose={onClose}
                onLeaveRoom={onLeaveRoom}
              />
            ),
          },
        ]
      : [],
    settings: [
      {
        id: "cloud-collaboration",
        title: "Cloud collaboration",
        render: () => (
          <div className="settingsInfoRow">
            <span>First-party contribution</span>
            <strong>Spike</strong>
          </div>
        ),
      },
    ],
    statusItems: [
      {
        id: "cloud-collaboration",
        render: () => (spike ? <span>Cloud room</span> : null),
      },
    ],
  };
}

export function createCloudRoomEditorContribution({
  ytext,
  awareness,
}: {
  ytext: Y.Text;
  awareness: YAwarenessLike;
}): EditorContribution {
  return {
    id: "cloud-room-yjs",
    extensions: [yCollab(ytext, awareness, { undoManager: false })],
  };
}

function CloudCollaborationPanel({
  context,
  spike,
  onClose,
  onLeaveRoom,
}: {
  context: AppContributionContext;
  spike: CloudCollaborationSpikeSession;
  onClose: () => void;
  onLeaveRoom: () => void;
}) {
  const [materialized, setMaterialized] = useState(() => spike.materializeMarkdown());
  const [participants, setParticipants] = useState(() => spike.getPresenceParticipants());
  const [commentMapping, setCommentMapping] = useState(() => spike.getCommentMappingSummary());

  useEffect(() => {
    const update = () => {
      setMaterialized(spike.materializeMarkdown());
      setCommentMapping(spike.getCommentMappingSummary());
    };
    spike.ytext.observe(update);
    return () => {
      spike.ytext.unobserve(update);
    };
  }, [spike]);

  useEffect(() => {
    const updatePresence = () => setParticipants(spike.getPresenceParticipants());
    spike.awareness.primary.on("change", updatePresence);
    return () => {
      spike.awareness.primary.off("change", updatePresence);
    };
  }, [spike]);

  return (
    <aside className="cloudPanel" aria-label="Collaboration spike">
      <div className="cloudPanelHeader">
        <div>
          <h2>Collaboration</h2>
          <p>{spike.session.title}</p>
        </div>
        <button className="iconButton" type="button" title="Close collaboration" aria-label="Close collaboration" onClick={onClose}>
          <PanelRightClose size={16} />
        </button>
      </div>

      <div className="cloudRoomActions">
        <div>
          <strong>{context.session.kind === "cloud-room" ? context.session.roomId : "local-file"}</strong>
          <span>Mock room session · deterministic Markdown snapshots</span>
        </div>
        <button type="button" className="settingsActionButton" onClick={onLeaveRoom}>
          Leave room
        </button>
      </div>

      <PresenceList participants={participants} />

      <div className="cloudClientStack">
        <CloudClientEditor
          label="Peer client"
          participant={spike.participants[1]}
          ytext={spike.ytext}
          awareness={spike.awareness.secondary}
        />
      </div>

      <div className="cloudMaterialization">
        <div className="cloudMaterializationHeader">
          <div>
            <h3>Markdown snapshot</h3>
            <p>
              {commentMapping.anchors} anchors · {commentMapping.threads} threads · {commentMapping.orphaned} orphaned
            </p>
          </div>
          <span title="Deterministic .md materialization" aria-label="Deterministic .md materialization">
            <Check size={14} />
          </span>
        </div>
        <pre>{materialized}</pre>
      </div>
    </aside>
  );
}

function PresenceList({ participants }: { participants: PresenceParticipant[] }) {
  return (
    <div className="presenceList" aria-label="Presence">
      {participants.map((participant) => (
        <div className="presenceItem" key={participant.id}>
          <span className="presenceSwatch" style={{ background: participant.color }} />
          <div>
            <strong>{participant.name}</strong>
            <span>{participant.kind === "ai-agent" ? `AI agent · ${participant.authorizedBy}` : "Human"}</span>
          </div>
          {participant.kind === "ai-agent" ? <Bot size={14} /> : <Users size={14} />}
        </div>
      ))}
    </div>
  );
}

function CloudClientEditor({
  label,
  participant,
  ytext,
  awareness,
}: {
  label: string;
  participant: PresenceParticipant;
  ytext: Y.Text;
  awareness: YAwarenessLike;
}) {
  const [raw, setRaw] = useState(false);
  const [activeFormat, setActiveFormat] = useState<ActiveFormat>(emptyFormat);
  const contribution = useMemo(() => createCloudRoomEditorContribution({ ytext, awareness }), [awareness, ytext]);
  const contributions = useMemo(() => [contribution], [contribution]);
  const initialMarkdown = useMemo(() => ytext.toString(), [ytext]);
  const ignoreMarkdownChange = useCallback(() => undefined, []);
  const ignoreSelectionChange = useCallback(() => undefined, []);
  const handleReady = useCallback(() => undefined, []);

  return (
    <section className="cloudClient" aria-label={label}>
      <header>
        <div>
          <span className="presenceSwatch" style={{ background: participant.color }} />
          <strong>{label}</strong>
          <span>{participant.name}</span>
        </div>
        <button
          className="iconButton"
          type="button"
          title={raw ? "Rendered view" : "Raw markdown view"}
          aria-label={raw ? "Rendered view" : "Raw markdown view"}
          aria-pressed={raw}
          onClick={() => setRaw((value) => !value)}
        >
          <FileText size={14} />
        </button>
      </header>
      <div className="cloudClientEditor">
        <MarkdownEditor
          value={initialMarkdown}
          zen={false}
          raw={raw}
          contentWidth="full"
          onChange={ignoreMarkdownChange}
          onFormatChange={setActiveFormat}
          onSelectionChange={ignoreSelectionChange}
          onReady={handleReady}
          contributions={contributions}
        />
      </div>
      <footer>
        <span>{activeFormat.heading ? `H${activeFormat.heading}` : "Body"}</span>
        <span>{raw ? "Raw" : "Rendered"}</span>
      </footer>
    </section>
  );
}
