import { expect, test } from "@playwright/test";
import {
  CLOUD_AUDIT_EVENT_KINDS,
  CLOUD_BLOB_ENCRYPTIONS,
  CLOUD_INVITE_ROLES,
  CLOUD_MATERIALIZATION_REASONS,
  CLOUD_ROOM_MODES,
  CLOUD_ROOM_ROLES,
  CLOUD_ROOM_SOURCES,
  cloudBackendSchema,
  findColumn,
  getColumn,
  getTable,
  renderSchemaSql,
  type CloudSchemaColumn,
  type CloudSchemaTable,
} from "../../src/cloudCollaboration/backendSchema";

const REQUIRED_TABLES = [
  "tenants",
  "users",
  "documents",
  "document_memberships",
  "document_invites",
  "document_password_verifiers",
  "document_yjs_checkpoints",
  "document_yjs_update_archives",
  "document_markdown_snapshots",
  "document_versions",
  "document_audit_events",
] as const;

const PLAINTEXT_BODY_COLUMN_NAMES = ["content", "body", "markdown", "plaintext", "snapshot", "yjs_state"];

const ENCRYPTED_BLOB_TABLES = [
  "document_yjs_checkpoints",
  "document_yjs_update_archives",
  "document_markdown_snapshots",
] as const;

test.describe("cloud backend Postgres schema", () => {
  test("declares every required cloud collaboration metadata table", () => {
    const tableNames = cloudBackendSchema.tables.map((table) => table.name);
    for (const required of REQUIRED_TABLES) {
      expect(tableNames).toContain(required);
    }
  });

  test("scopes every cloud table to a tenant boundary", () => {
    for (const table of cloudBackendSchema.tables) {
      if (!table.tenantScoped) {
        continue;
      }
      const tenantColumn = findColumn(table, "tenant_id");
      expect(tenantColumn, `table ${table.name} is tenant scoped but is missing tenant_id`).toBeDefined();
      expect(tenantColumn?.type).toBe("uuid");
      expect(tenantColumn?.nullable).not.toBe(true);
      expect(tenantColumn?.references).toEqual(
        expect.objectContaining({ table: "tenants", column: "id" }),
      );
    }
  });

  test("models anonymous, account, and claim transitions on documents", () => {
    const documents = getTable(cloudBackendSchema, "documents");
    expectEnum(getColumn(documents, "mode"), [...CLOUD_ROOM_MODES]);
    expectEnum(getColumn(documents, "source"), [...CLOUD_ROOM_SOURCES]);

    const ownerUser = getColumn(documents, "owner_user_id");
    expect(ownerUser.nullable).toBe(true);
    expect(ownerUser.references).toMatchObject({ table: "users", column: "id" });

    const capabilityHash = getColumn(documents, "anonymous_owner_capability_hash");
    expect(capabilityHash.nullable).toBe(true);
    expect(capabilityHash.type).toBe("text");

    const expiresAt = getColumn(documents, "expires_at");
    expect(expiresAt.nullable).toBe(true);
    expect(expiresAt.type).toBe("timestamptz");

    const claimedAt = getColumn(documents, "claimed_at");
    expect(claimedAt.nullable).toBe(true);
    expect(claimedAt.type).toBe("timestamptz");
  });

  test("stores password verifier metadata without plaintext passwords", () => {
    const verifiers = getTable(cloudBackendSchema, "document_password_verifiers");

    for (const forbidden of ["password", "plaintext", "password_plaintext", "raw_password"]) {
      expect(findColumn(verifiers, forbidden), `${forbidden} column must not exist`).toBeUndefined();
    }

    const algorithm = getColumn(verifiers, "algorithm");
    expect(algorithm.default).toBe("'argon2id'");

    expect(getColumn(verifiers, "salt").type).toBe("bytea");
    expect(getColumn(verifiers, "verifier_hash").type).toBe("bytea");
    expect(getColumn(verifiers, "params_version").type).toBe("integer");
    expect(getColumn(verifiers, "document_id").primaryKey).toBe(true);
  });

  test("models room membership roles with the cloud role enum", () => {
    const memberships = getTable(cloudBackendSchema, "document_memberships");
    expectEnum(getColumn(memberships, "role"), [...CLOUD_ROOM_ROLES]);
    expect(getColumn(memberships, "document_id").references).toMatchObject({
      table: "documents",
      column: "id",
      onDelete: "cascade",
    });
    expect(memberships.uniques?.[0]?.columns).toEqual(["document_id", "user_id"]);
  });

  test("hashes invite secrets, never plaintext, with role and revocation metadata", () => {
    const invites = getTable(cloudBackendSchema, "document_invites");
    expect(findColumn(invites, "invite_secret")).toBeUndefined();
    expect(findColumn(invites, "invite_secret_plaintext")).toBeUndefined();

    const inviteHash = getColumn(invites, "invite_secret_hash");
    expect(inviteHash.type).toBe("text");
    expect(inviteHash.nullable).not.toBe(true);
    expect(invites.uniques?.some((unique) => unique.columns.includes("invite_secret_hash"))).toBe(true);

    expectEnum(getColumn(invites, "role"), [...CLOUD_INVITE_ROLES]);
    expect(getColumn(invites, "revoked_at").nullable).toBe(true);
    expect(getColumn(invites, "expires_at").nullable).toBe(true);
    expect(getColumn(invites, "used_count").default).toBe("0");
  });

  test("encrypted persistence tables expose blob refs and never plaintext content", () => {
    for (const tableName of ENCRYPTED_BLOB_TABLES) {
      const table = getTable(cloudBackendSchema, tableName);
      expectEncryptedPersistenceTable(table);
    }

    const snapshots = getTable(cloudBackendSchema, "document_markdown_snapshots");
    expectEnum(getColumn(snapshots, "materialization_reason"), [...CLOUD_MATERIALIZATION_REASONS]);

    const archives = getTable(cloudBackendSchema, "document_yjs_update_archives");
    expect(getColumn(archives, "range_start").type).toBe("bigint");
    expect(getColumn(archives, "range_end").type).toBe("bigint");
  });

  test("links versions to encrypted checkpoint and snapshot rows", () => {
    const versions = getTable(cloudBackendSchema, "document_versions");
    expect(getColumn(versions, "checkpoint_id").references).toMatchObject({
      table: "document_yjs_checkpoints",
      column: "id",
    });
    expect(getColumn(versions, "snapshot_id").references).toMatchObject({
      table: "document_markdown_snapshots",
      column: "id",
    });
    expectEnum(getColumn(versions, "reason"), [...CLOUD_MATERIALIZATION_REASONS]);
    expect(getColumn(versions, "created_by_user_id").nullable).toBe(true);
    expect(getColumn(versions, "created_by_agent_id").nullable).toBe(true);
  });

  test("models audit events for human, anonymous, and AI-agent actors", () => {
    const events = getTable(cloudBackendSchema, "document_audit_events");
    expectEnum(getColumn(events, "kind"), [...CLOUD_AUDIT_EVENT_KINDS]);

    expect(getColumn(events, "actor_user_id").nullable).toBe(true);
    expect(getColumn(events, "actor_agent_id").nullable).toBe(true);
    expect(getColumn(events, "actor_guest_id").nullable).toBe(true);
    expect(getColumn(events, "authorized_by_user_id").references).toMatchObject({
      table: "users",
      column: "id",
    });
    expect(getColumn(events, "payload").type).toBe("jsonb");
  });

  test("renderSchemaSql emits create-table statements for every defined table", () => {
    const sql = renderSchemaSql();
    expect(sql).toContain("Cloud collaboration metadata schema");
    for (const required of REQUIRED_TABLES) {
      expect(sql).toContain(`CREATE TABLE ${required} (`);
    }
    expect(sql).toContain("REFERENCES tenants(id)");
    expect(sql).toContain("REFERENCES documents(id) ON DELETE CASCADE");
    expect(sql).toMatch(/CHECK \(mode IN \('anonymous', 'account'\)\)/);
    expect(sql).toMatch(/CHECK \(encryption IN \('application-level-at-rest'\)\)/);
  });
});

function expectEncryptedPersistenceTable(table: CloudSchemaTable) {
  for (const forbidden of PLAINTEXT_BODY_COLUMN_NAMES) {
    expect(findColumn(table, forbidden), `${table.name}.${forbidden} must not exist`).toBeUndefined();
  }

  const blobRef = getColumn(table, "blob_ref");
  expect(blobRef.type).toBe("text");
  expect(blobRef.nullable).not.toBe(true);

  const wrappedKey = getColumn(table, "wrapped_key_id");
  expect(wrappedKey.type).toBe("text");
  expect(wrappedKey.nullable).not.toBe(true);

  const byteLength = getColumn(table, "byte_length");
  expect(byteLength.type).toBe("integer");
  expect(byteLength.nullable).not.toBe(true);

  expectEnum(getColumn(table, "encryption"), [...CLOUD_BLOB_ENCRYPTIONS]);

  const documentRef = getColumn(table, "document_id").references;
  expect(documentRef).toMatchObject({ table: "documents", column: "id", onDelete: "cascade" });
}

function expectEnum(column: CloudSchemaColumn, values: string[]) {
  expect(column.enumValues).toEqual(values);
}
