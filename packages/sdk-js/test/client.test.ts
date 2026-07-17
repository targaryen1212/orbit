import assert from "node:assert/strict";
import test from "node:test";
import { OrbitClient } from "../src/index.js";

test("bookmark ingestion keeps private V2 routes inside the SDK", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbitClient({
    baseUrl: "https://api.example.com/v2",
    apiPath: false,
    apiKey: "extension-token",
    client: { version: "1.2.3", platform: "chrome" },
    fetch: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith("/bookmarks/existence")) {
        return Response.json({ data: { existingUrls: ["https://example.com/already"] } });
      }
      return Response.json({ data: { id: "bookmark-1" } });
    },
  });

  await client.bookmarks.createItem({
    source: { type: "url", url: "https://example.com/story", platform: "web" },
    title: "Story",
    metadata: { idempotencyKey: "capture-1" },
  });
  const existing = await client.bookmarks.findExistingUrls([
    "https://example.com/already",
    "https://example.com/new",
  ]);

  assert.equal(requests[0]?.url, "https://api.example.com/v2/bookmarks");
  assert.equal(new Headers(requests[0]?.init.headers).get("authorization"), "Bearer extension-token");
  assert.equal(new Headers(requests[0]?.init.headers).get("idempotency-key"), "capture-1");
  assert.equal(new Headers(requests[0]?.init.headers).get("x-orbb-client-platform"), "chrome");
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    sourcePlatform: "web",
    sourcePermalinkUrl: "https://example.com/story",
    sourceOriginalSharedUrl: "https://example.com/story",
    sourceCanonicalUrl: "https://example.com/story",
    sourceHost: "example.com",
    displayTitle: "Story",
    platformDisplayName: "web",
    type: "url",
    isTextOnly: false,
    details: { searchableText: "Story" },
  });
  assert.equal("category" in JSON.parse(String(requests[0]?.init.body)), false);
  assert.equal(requests[1]?.url, "https://api.example.com/v2/bookmarks/existence");
  assert.deepEqual([...existing], ["https://example.com/already"]);
});

test("bookmark ingestion uploads and finalizes local media through the SDK", async () => {
  const urls: string[] = [];
  const client = new OrbitClient({
    baseUrl: "https://api.example.com/v2",
    apiPath: false,
    apiKey: "extension-token",
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/media/upload-url")) {
        return Response.json({ data: { mediaObjectId: "media-1", uploadUrl: "https://uploads.example.com/signed" } });
      }
      if (url === "https://uploads.example.com/signed") return new Response(null, { status: 200 });
      return Response.json({ data: { id: "bookmark-1" } });
    },
  });

  await client.bookmarks.createItem({
    source: {
      type: "image",
      platform: "chrome",
      raw: { dataUrl: "data:image/png;base64,aGVsbG8=" },
    },
    title: "Dropped image",
  });

  assert.deepEqual(urls, [
    "https://api.example.com/v2/media/upload-url",
    "https://uploads.example.com/signed",
    "https://api.example.com/v2/media/finalize",
    "https://api.example.com/v2/bookmarks",
  ]);
});

test("QR polling posts the private code in JSON and authenticated sign-out revokes the session", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbitClient({
    baseUrl: "https://api.example.com/v2",
    apiPath: false,
    apiKey: "extension-token",
    fetch: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith("/auth/extension/revoke")) {
        return Response.json({ status: "revoked" });
      }
      return Response.json({
        schemaVersion: "orbit.auth.qr_result.v0",
        sessionId: "session/one",
        status: "consumed",
      });
    },
  });

  const poll = await client.auth.qr.poll({ sessionId: "session/one", code: "private code" });
  const revoked = await client.auth.revokeCurrentSession();

  assert.equal(poll.status, "consumed");
  assert.equal(requests[0]?.url, "https://api.example.com/v2/auth/qr/sessions/session%2Fone");
  assert.equal(requests[0]?.init.method, "POST");
  assert.equal(String(requests[0]?.init.body), JSON.stringify({ code: "private code" }));
  assert.equal(requests[0]?.url.includes("private"), false);
  assert.equal(new Headers(requests[0]?.init.headers).get("authorization"), "Bearer extension-token");
  assert.deepEqual(revoked, { status: "revoked" });
  assert.equal(requests[1]?.url, "https://api.example.com/v2/auth/extension/revoke");
  assert.equal(requests[1]?.init.method, "POST");
  assert.equal(new Headers(requests[1]?.init.headers).get("authorization"), "Bearer extension-token");
});

test("equivalent URL capture requests derive the same stable create identity", async () => {
  const keys: string[] = [];
  const client = new OrbitClient({
    baseUrl: "https://api.example.com/v2",
    apiPath: false,
    fetch: async (_input, init = {}) => {
      keys.push(new Headers(init.headers).get("idempotency-key") ?? "");
      return Response.json({ data: { id: "bookmark-1" } });
    },
  });

  await client.bookmarks.createItem({
    source: {
      type: "url",
      url: "https://EXAMPLE.com/story?b=2&a=1#section",
      platform: "web",
      capturedAt: "2026-07-17T00:00:00.000Z",
    },
    title: "Story",
  });
  await client.bookmarks.createItem({
    title: "Story",
    source: {
      platform: "web",
      url: "https://example.com/story?a=1&b=2",
      type: "url",
      capturedAt: "2026-07-17T01:00:00.000Z",
    },
  });

  assert.match(keys[0] ?? "", /^orbit:url:[a-f0-9]{64}$/);
  assert.equal(keys[1], keys[0]);
});

test("text captures retry stably without collapsing separate capture objects", async () => {
  const keys: string[] = [];
  const client = new OrbitClient({
    baseUrl: "https://api.example.com/v2",
    apiPath: false,
    fetch: async (_input, init = {}) => {
      keys.push(new Headers(init.headers).get("idempotency-key") ?? "");
      return Response.json({ data: { id: "bookmark-1" } });
    },
  });
  const capture = { source: { type: "text" as const, text: "Remember this" } };

  await client.bookmarks.createItem(capture);
  await client.bookmarks.createItem(capture);
  await client.bookmarks.createItem({ source: { type: "text", text: "Remember this" } });

  assert.match(keys[0] ?? "", /^orbit:capture:[0-9a-f-]{36}$/);
  assert.equal(keys[1], keys[0]);
  assert.notEqual(keys[2], keys[0]);
});

test("media retries reuse stable upload, finalize, and create identities", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new OrbitClient({
    baseUrl: "https://api.example.com/v2",
    apiPath: false,
    fetch: async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/media/upload-url")) {
        return Response.json({ data: { mediaObjectId: "media-1", uploadUrl: "https://uploads.example.com/signed" } });
      }
      if (url === "https://uploads.example.com/signed") return new Response(null, { status: 200 });
      return Response.json({ data: { id: "bookmark-1" } });
    },
  });
  const capture = {
    source: {
      type: "image" as const,
      raw: { dataUrl: "data:image/png;base64,aGVsbG8=" },
    },
  };

  await client.bookmarks.createItem(capture);
  await client.bookmarks.createItem(capture);

  const mutationRequests = requests.filter(({ url }) => url !== "https://uploads.example.com/signed");
  const firstKeys = mutationRequests.slice(0, 3).map(({ init }) =>
    new Headers(init.headers).get("idempotency-key"),
  );
  const retryKeys = mutationRequests.slice(3, 6).map(({ init }) =>
    new Headers(init.headers).get("idempotency-key"),
  );
  assert.deepEqual(retryKeys, firstKeys);
  assert.equal(new Set(firstKeys).size, 3);
  assert.match(firstKeys[0] ?? "", /^orbit:upload:[a-f0-9]{64}$/);
  assert.match(firstKeys[1] ?? "", /^orbit:finalize:[a-f0-9]{64}$/);
  assert.match(firstKeys[2] ?? "", /^orbit:capture:[0-9a-f-]{36}$/);

  const firstUploadBody = JSON.parse(String(mutationRequests[0]?.init.body));
  const retryUploadBody = JSON.parse(String(mutationRequests[3]?.init.body));
  assert.equal(firstUploadBody.clientRequestId, retryUploadBody.clientRequestId);
  assert.match(firstUploadBody.clientRequestId, /^orbit:media:[a-f0-9]{64}$/);
});
