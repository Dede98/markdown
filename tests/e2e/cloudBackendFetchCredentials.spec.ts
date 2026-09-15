import { expect, test } from "@playwright/test";
import type { CloudAccessContext, CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";
import { createCloudBackendFetchTransport } from "../../src/cloudCollaboration/backendFetchTransport";
import { createCloudBackendHttpClient } from "../../src/cloudCollaboration/backendHttpClient";

const account: CloudAccountAuth = { kind: "account", userId: "selected-account", tenantId: "selected-tenant" };
const defaultAccount: CloudAccountAuth = { kind: "account", userId: "default-account", tenantId: "default-tenant" };
const contexts: CloudAccessContext[] = [
  account,
  { kind: "invite", inviteSecret: "invite-capability", auth: account },
];

for (const access of contexts) {
  test(`requires credentials for ${access.kind} account access before sending`, async () => {
    let sends = 0;
    const client = createCloudBackendHttpClient({ transport: createCloudBackendFetchTransport({
      baseUrl: "https://cloud.invalid",
      fetch: async () => { sends += 1; return Response.json({ error: "Denied" }, { status: 403 }); },
    }) });
    await expect(client.joinRoom({ roomId: "private-room", access })).rejects.toMatchObject({ code: "missing_header_mapping" });
    expect(sends).toBe(0);
  });

  test(`selects explicit ${access.kind} credentials without serializing account assertions`, async () => {
    let selected: CloudAccountAuth | undefined;
    let sent: Request | undefined;
    const client = createCloudBackendHttpClient({ auth: defaultAccount, transport: createCloudBackendFetchTransport({
      baseUrl: "https://cloud.invalid",
      headers: ({ sensitive }) => { selected = sensitive.accountAuth; return { authorization: "Bearer selected-credential" }; },
      fetch: async input => { sent = new Request(input); return Response.json({ error: "Denied" }, { status: 403 }); },
    }) });
    await expect(client.joinRoom({ roomId: "private-room", access })).rejects.toMatchObject({ code: "route_failed", status: 403 });
    expect(selected).toEqual(account);
    expect(sent!.headers.get("authorization")).toBe("Bearer selected-credential");
    const body = await sent!.json();
    expect(body.access).toEqual(access.kind === "account"
      ? { kind: "account" }
      : { kind: "invite", inviteSecret: "invite-capability", auth: { kind: "account" } });
    expect(JSON.stringify(body)).not.toContain(account.userId);
    expect(JSON.stringify(body)).not.toContain(account.tenantId);
  });
}

test("preserves the service's top-level invite precedence", async () => {
  let selected: CloudAccountAuth | undefined;
  const client = createCloudBackendHttpClient({ auth: defaultAccount, transport: createCloudBackendFetchTransport({
    baseUrl: "https://cloud.invalid",
    headers: ({ sensitive }) => { selected = sensitive.accountAuth; return { authorization: "Bearer default-credential" }; },
    fetch: async () => Response.json({ error: "Denied" }, { status: 403 }),
  }) });
  await expect(client.joinRoom({ roomId: "private-room", inviteSecret: "top-level-invite", access: account })).rejects.toMatchObject({ code: "route_failed" });
  expect(selected).toEqual(defaultAccount);
});
