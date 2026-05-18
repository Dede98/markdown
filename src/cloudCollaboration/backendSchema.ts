export type CloudSchemaColumnType =
  | "uuid"
  | "text"
  | "bytea"
  | "integer"
  | "bigint"
  | "jsonb"
  | "timestamptz";

export type CloudSchemaForeignKey = {
  table: string;
  column: string;
  onDelete?: "cascade" | "set null" | "restrict";
};

export type CloudSchemaColumn = {
  name: string;
  type: CloudSchemaColumnType;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  default?: string;
  check?: string;
  enumValues?: string[];
  references?: CloudSchemaForeignKey;
  notes?: string;
};

export type CloudSchemaIndex = {
  name: string;
  columns: string[];
  unique?: boolean;
};

export type CloudSchemaUniqueConstraint = {
  name: string;
  columns: string[];
};

export type CloudSchemaTable = {
  name: string;
  description: string;
  tenantScoped: boolean;
  columns: CloudSchemaColumn[];
  uniques?: CloudSchemaUniqueConstraint[];
  indexes?: CloudSchemaIndex[];
};

export type CloudSchemaDefinition = {
  version: string;
  tables: CloudSchemaTable[];
};

export const CLOUD_ROOM_ROLES = ["owner", "admin", "editor", "commenter", "viewer"] as const;
export const CLOUD_INVITE_ROLES = ["admin", "editor", "commenter", "viewer"] as const;
export const CLOUD_ROOM_MODES = ["anonymous", "account"] as const;
export const CLOUD_ROOM_SOURCES = ["local-file"] as const;
export const CLOUD_MATERIALIZATION_REASONS = [
  "manual",
  "autosnapshot",
  "before_ai_edit",
  "restore",
  "room_close",
] as const;
export const CLOUD_BLOB_ENCRYPTIONS = ["application-level-at-rest"] as const;
export const CLOUD_AUDIT_EVENT_KINDS = [
  "room_created",
  "room_joined",
  "room_left",
  "room_claimed",
  "room_password_set",
  "room_password_rotated",
  "room_password_cleared",
  "invite_created",
  "invite_redeemed",
  "invite_revoked",
  "member_added",
  "member_role_changed",
  "member_removed",
  "ai_session_started",
  "ai_session_ended",
  "snapshot_materialized",
  "version_created",
  "version_restored",
] as const;

const TENANT_REF: CloudSchemaForeignKey = { table: "tenants", column: "id", onDelete: "restrict" };
const USER_REF: CloudSchemaForeignKey = { table: "users", column: "id", onDelete: "restrict" };
const DOCUMENT_REF: CloudSchemaForeignKey = { table: "documents", column: "id", onDelete: "cascade" };

export const cloudBackendSchema: CloudSchemaDefinition = {
  version: "v1",
  tables: [
    {
      name: "tenants",
      description: "Tenant/workspace boundary. Personal workspace in v1; multi-tenant later.",
      tenantScoped: false,
      columns: [
        { name: "id", type: "uuid", primaryKey: true },
        { name: "name", type: "text" },
        {
          name: "kind",
          type: "text",
          default: "'personal'",
          enumValues: ["personal", "org"],
        },
        { name: "created_at", type: "timestamptz", default: "now()" },
      ],
    },
    {
      name: "users",
      description: "Account identity for Cloud collaboration. Not required for local .md editing.",
      tenantScoped: true,
      columns: [
        { name: "id", type: "uuid", primaryKey: true },
        { name: "tenant_id", type: "uuid", references: TENANT_REF },
        { name: "display_name", type: "text" },
        {
          name: "email",
          type: "text",
          nullable: true,
          notes: "Optional. Hidden is not private; never used as a default comment author identifier.",
        },
        { name: "local_uuid", type: "text", nullable: true, notes: "Claim continuity for prior offline comments." },
        { name: "created_at", type: "timestamptz", default: "now()" },
      ],
      uniques: [{ name: "users_tenant_email_unique", columns: ["tenant_id", "email"] }],
      indexes: [{ name: "users_tenant_idx", columns: ["tenant_id"] }],
    },
    {
      name: "documents",
      description:
        "Cloud collaboration rooms. Models anonymous temporary rooms, account-owned rooms, and the claim transition.",
      tenantScoped: true,
      columns: [
        { name: "id", type: "uuid", primaryKey: true },
        { name: "tenant_id", type: "uuid", references: TENANT_REF },
        { name: "title", type: "text" },
        { name: "source", type: "text", enumValues: [...CLOUD_ROOM_SOURCES] },
        { name: "mode", type: "text", enumValues: [...CLOUD_ROOM_MODES] },
        {
          name: "owner_user_id",
          type: "uuid",
          nullable: true,
          references: USER_REF,
          notes: "Null while a room is anonymous and unclaimed.",
        },
        {
          name: "anonymous_owner_capability_hash",
          type: "text",
          nullable: true,
          notes:
            "Hash of the anonymous owner capability secret. Null after claim, never plaintext, never returned to clients.",
        },
        {
          name: "expires_at",
          type: "timestamptz",
          nullable: true,
          notes: "TTL for unclaimed anonymous rooms. Null after claim.",
        },
        { name: "claimed_at", type: "timestamptz", nullable: true, notes: "Set when an anonymous room is claimed." },
        { name: "created_at", type: "timestamptz", default: "now()" },
        { name: "updated_at", type: "timestamptz", default: "now()" },
      ],
      indexes: [
        { name: "documents_tenant_idx", columns: ["tenant_id"] },
        { name: "documents_tenant_owner_idx", columns: ["tenant_id", "owner_user_id"] },
      ],
    },
    {
      name: "document_memberships",
      description: "Account membership and role in a cloud room.",
      tenantScoped: true,
      columns: [
        { name: "id", type: "uuid", primaryKey: true },
        { name: "tenant_id", type: "uuid", references: TENANT_REF },
        { name: "document_id", type: "uuid", references: DOCUMENT_REF },
        { name: "user_id", type: "uuid", references: USER_REF },
        { name: "role", type: "text", enumValues: [...CLOUD_ROOM_ROLES] },
        { name: "created_at", type: "timestamptz", default: "now()" },
        { name: "revoked_at", type: "timestamptz", nullable: true },
      ],
      uniques: [{ name: "document_memberships_user_unique", columns: ["document_id", "user_id"] }],
      indexes: [{ name: "document_memberships_doc_idx", columns: ["document_id"] }],
    },
    {
      name: "document_invites",
      description: "Hashed invite secrets for room access. Plaintext invite secrets are never stored.",
      tenantScoped: true,
      columns: [
        { name: "id", type: "uuid", primaryKey: true },
        { name: "tenant_id", type: "uuid", references: TENANT_REF },
        { name: "document_id", type: "uuid", references: DOCUMENT_REF },
        {
          name: "invite_secret_hash",
          type: "text",
          notes: "Hash of the invite secret. Plaintext invite secret only lives in share URLs.",
        },
        { name: "role", type: "text", enumValues: [...CLOUD_INVITE_ROLES] },
        {
          name: "created_by_user_id",
          type: "uuid",
          nullable: true,
          references: USER_REF,
          notes: "Null when an anonymous room owner created the invite via owner capability.",
        },
        { name: "audience", type: "text", nullable: true },
        { name: "max_uses", type: "integer", nullable: true },
        { name: "used_count", type: "integer", default: "0" },
        { name: "expires_at", type: "timestamptz", nullable: true },
        { name: "revoked_at", type: "timestamptz", nullable: true },
        { name: "created_at", type: "timestamptz", default: "now()" },
      ],
      uniques: [{ name: "document_invites_secret_unique", columns: ["invite_secret_hash"] }],
      indexes: [{ name: "document_invites_doc_idx", columns: ["document_id"] }],
    },
    {
      name: "document_password_verifiers",
      description:
        "Argon2id-style password verifier per room. No plaintext password is ever stored; passwords are access gates, not identity.",
      tenantScoped: true,
      columns: [
        {
          name: "document_id",
          type: "uuid",
          primaryKey: true,
          references: DOCUMENT_REF,
          notes: "One verifier per room; rotation overwrites in place.",
        },
        { name: "tenant_id", type: "uuid", references: TENANT_REF },
        { name: "algorithm", type: "text", default: "'argon2id'" },
        { name: "params_version", type: "integer", default: "1" },
        { name: "salt", type: "bytea", notes: "Per-room random salt." },
        { name: "verifier_hash", type: "bytea", notes: "Password verifier output. Never plaintext." },
        { name: "rotated_at", type: "timestamptz", default: "now()" },
      ],
    },
    {
      name: "document_yjs_checkpoints",
      description:
        "Encrypted compacted Yjs state blobs. References object storage or bytea; plaintext Yjs body never stored here.",
      tenantScoped: true,
      columns: [
        { name: "id", type: "uuid", primaryKey: true },
        { name: "tenant_id", type: "uuid", references: TENANT_REF },
        { name: "document_id", type: "uuid", references: DOCUMENT_REF },
        { name: "blob_ref", type: "text", notes: "Opaque reference to encrypted Yjs state blob." },
        { name: "state_vector", type: "bytea", notes: "Yjs state vector for incremental sync." },
        { name: "wrapped_key_id", type: "text", notes: "KMS/key-manager reference for the wrapped document data key." },
        { name: "byte_length", type: "integer" },
        { name: "encryption", type: "text", default: "'application-level-at-rest'", enumValues: [...CLOUD_BLOB_ENCRYPTIONS] },
        { name: "created_at", type: "timestamptz", default: "now()" },
      ],
      indexes: [{ name: "document_yjs_checkpoints_doc_idx", columns: ["document_id", "created_at"] }],
    },
    {
      name: "document_yjs_update_archives",
      description:
        "Encrypted append-only Yjs update segments between checkpoints. Plaintext Yjs updates are never persisted here.",
      tenantScoped: true,
      columns: [
        { name: "id", type: "uuid", primaryKey: true },
        { name: "tenant_id", type: "uuid", references: TENANT_REF },
        { name: "document_id", type: "uuid", references: DOCUMENT_REF },
        { name: "blob_ref", type: "text", notes: "Encrypted blob reference for the archived update segment." },
        { name: "range_start", type: "bigint" },
        { name: "range_end", type: "bigint" },
        { name: "wrapped_key_id", type: "text" },
        { name: "byte_length", type: "integer" },
        { name: "encryption", type: "text", default: "'application-level-at-rest'", enumValues: [...CLOUD_BLOB_ENCRYPTIONS] },
        { name: "created_at", type: "timestamptz", default: "now()" },
      ],
      indexes: [{ name: "document_yjs_update_archives_doc_idx", columns: ["document_id", "range_start"] }],
    },
    {
      name: "document_markdown_snapshots",
      description:
        "Encrypted deterministic .md materializations. Plaintext Markdown body never stored in metadata tables.",
      tenantScoped: true,
      columns: [
        { name: "id", type: "uuid", primaryKey: true },
        { name: "tenant_id", type: "uuid", references: TENANT_REF },
        { name: "document_id", type: "uuid", references: DOCUMENT_REF },
        { name: "blob_ref", type: "text", notes: "Encrypted blob reference for the materialized Markdown snapshot." },
        { name: "wrapped_key_id", type: "text" },
        { name: "byte_length", type: "integer" },
        { name: "encryption", type: "text", default: "'application-level-at-rest'", enumValues: [...CLOUD_BLOB_ENCRYPTIONS] },
        {
          name: "materialization_reason",
          type: "text",
          enumValues: [...CLOUD_MATERIALIZATION_REASONS],
        },
        { name: "created_at", type: "timestamptz", default: "now()" },
      ],
      indexes: [{ name: "document_markdown_snapshots_doc_idx", columns: ["document_id", "created_at"] }],
    },
    {
      name: "document_versions",
      description:
        "User-facing named or automatic versions. Each version references a Yjs checkpoint and a Markdown snapshot.",
      tenantScoped: true,
      columns: [
        { name: "id", type: "uuid", primaryKey: true },
        { name: "tenant_id", type: "uuid", references: TENANT_REF },
        { name: "document_id", type: "uuid", references: DOCUMENT_REF },
        {
          name: "checkpoint_id",
          type: "uuid",
          references: { table: "document_yjs_checkpoints", column: "id", onDelete: "restrict" },
        },
        {
          name: "snapshot_id",
          type: "uuid",
          references: { table: "document_markdown_snapshots", column: "id", onDelete: "restrict" },
        },
        { name: "reason", type: "text", enumValues: [...CLOUD_MATERIALIZATION_REASONS] },
        {
          name: "created_by_user_id",
          type: "uuid",
          nullable: true,
          references: USER_REF,
          notes: "Null for autosnapshots and anonymous-room versions.",
        },
        { name: "created_by_agent_id", type: "text", nullable: true, notes: "Visible AI-agent identity, if any." },
        { name: "label", type: "text", nullable: true },
        { name: "created_at", type: "timestamptz", default: "now()" },
      ],
      indexes: [{ name: "document_versions_doc_idx", columns: ["document_id", "created_at"] }],
    },
    {
      name: "document_audit_events",
      description: "Audit trail for room lifecycle, membership, AI sessions, snapshots, and versions.",
      tenantScoped: true,
      columns: [
        { name: "id", type: "uuid", primaryKey: true },
        { name: "tenant_id", type: "uuid", references: TENANT_REF },
        { name: "document_id", type: "uuid", references: DOCUMENT_REF },
        { name: "kind", type: "text", enumValues: [...CLOUD_AUDIT_EVENT_KINDS] },
        { name: "actor_user_id", type: "uuid", nullable: true, references: USER_REF },
        {
          name: "actor_agent_id",
          type: "text",
          nullable: true,
          notes: "AI-agent identity. Always paired with authorized_by_user_id.",
        },
        { name: "actor_guest_id", type: "text", nullable: true, notes: "Anonymous guest pseudonym." },
        {
          name: "authorized_by_user_id",
          type: "uuid",
          nullable: true,
          references: USER_REF,
          notes: "Required for AI sessions and other delegated actions.",
        },
        { name: "payload", type: "jsonb", default: "'{}'::jsonb" },
        { name: "created_at", type: "timestamptz", default: "now()" },
      ],
      indexes: [{ name: "document_audit_events_doc_idx", columns: ["document_id", "created_at"] }],
    },
  ],
};

export function findTable(schema: CloudSchemaDefinition, tableName: string): CloudSchemaTable | undefined {
  return schema.tables.find((table) => table.name === tableName);
}

export function getTable(schema: CloudSchemaDefinition, tableName: string): CloudSchemaTable {
  const table = findTable(schema, tableName);
  if (!table) {
    throw new Error(`Cloud schema is missing required table: ${tableName}`);
  }
  return table;
}

export function findColumn(table: CloudSchemaTable, columnName: string): CloudSchemaColumn | undefined {
  return table.columns.find((column) => column.name === columnName);
}

export function getColumn(table: CloudSchemaTable, columnName: string): CloudSchemaColumn {
  const column = findColumn(table, columnName);
  if (!column) {
    throw new Error(`Cloud schema table ${table.name} is missing required column: ${columnName}`);
  }
  return column;
}

export function renderSchemaSql(schema: CloudSchemaDefinition = cloudBackendSchema): string {
  const statements: string[] = [
    `-- Cloud collaboration metadata schema (${schema.version}).`,
    "-- Generated from src/cloudCollaboration/backendSchema.ts. Do not edit by hand.",
    "",
  ];
  for (const table of schema.tables) {
    statements.push(renderTable(table));
    for (const index of table.indexes ?? []) {
      statements.push(renderIndex(table, index));
    }
    statements.push("");
  }
  return statements.join("\n").trimEnd() + "\n";
}

function renderTable(table: CloudSchemaTable): string {
  const lines: string[] = [`-- ${table.description}`, `CREATE TABLE ${table.name} (`];
  const columnLines = table.columns.map((column) => `  ${renderColumn(column)}`);
  const constraintLines: string[] = [];
  for (const unique of table.uniques ?? []) {
    constraintLines.push(`  CONSTRAINT ${unique.name} UNIQUE (${unique.columns.join(", ")})`);
  }
  lines.push([...columnLines, ...constraintLines].join(",\n"));
  lines.push(");");
  return lines.join("\n");
}

function renderColumn(column: CloudSchemaColumn): string {
  const parts: string[] = [column.name, column.type.toUpperCase()];
  if (!column.nullable && !column.primaryKey) {
    parts.push("NOT NULL");
  }
  if (column.primaryKey) {
    parts.push("PRIMARY KEY");
  }
  if (column.unique && !column.primaryKey) {
    parts.push("UNIQUE");
  }
  if (column.default !== undefined) {
    parts.push(`DEFAULT ${column.default}`);
  }
  const check = renderCheck(column);
  if (check) {
    parts.push(check);
  }
  if (column.references) {
    const onDelete = column.references.onDelete ? ` ON DELETE ${column.references.onDelete.toUpperCase()}` : "";
    parts.push(`REFERENCES ${column.references.table}(${column.references.column})${onDelete}`);
  }
  return parts.join(" ");
}

function renderCheck(column: CloudSchemaColumn): string | undefined {
  if (column.check) {
    return `CHECK (${column.check})`;
  }
  if (column.enumValues && column.enumValues.length > 0) {
    const list = column.enumValues.map((value) => `'${value}'`).join(", ");
    return `CHECK (${column.name} IN (${list}))`;
  }
  return undefined;
}

function renderIndex(table: CloudSchemaTable, index: CloudSchemaIndex): string {
  const unique = index.unique ? "UNIQUE " : "";
  return `CREATE ${unique}INDEX ${index.name} ON ${table.name} (${index.columns.join(", ")});`;
}
