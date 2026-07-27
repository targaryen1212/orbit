import assert from "node:assert/strict";
import test from "node:test";
import {
  OrbitAbortError,
  OrbitApiError,
  OrbitClient,
  OrbitTimeoutError,
} from "../src/index.js";

const fastRetry = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 };

test("non-2xx responses throw OrbitApiError with status, code, and body", async () => {
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: false,
    fetch: async () =>
      Response.json(
        { error: { code: "not_found", message: "Item not found." } },
        { status: 404 },
      ),
  });

  const error = await client.items.get("missing").catch((caught) => caught);
  assert.ok(error instanceof OrbitApiError);
  assert.equal(error.status, 404);
  assert.equal(error.code, "not_found");
  assert.match(error.message, /404/);
  assert.match(error.message, /Item not found/);
  assert.deepEqual(error.body, { error: { code: "not_found", message: "Item not found." } });
});

test("HTML error pages are truncated instead of dumped into the message", async () => {
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: false,
    fetch: async () => new Response(`<html>${"x".repeat(5000)}</html>`, { status: 502 }),
  });

  const error = await client.items.get("a").catch((caught) => caught);
  assert.ok(error instanceof OrbitApiError);
  assert.equal(error.status, 502);
  assert.ok(error.message.length < 500);
});

test("idempotent requests retry through transient 5xx and succeed", async () => {
  let calls = 0;
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: fastRetry,
    fetch: async () => {
      calls += 1;
      if (calls < 3) return new Response("upstream boom", { status: 503 });
      return Response.json({ items: [], nextCursor: null });
    },
  });

  const page = await client.items.list();
  assert.equal(calls, 3);
  assert.deepEqual(page.items, []);
});

test("network errors on idempotent requests retry, and exhaust into the original error", async () => {
  let calls = 0;
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: fastRetry,
    fetch: async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    },
  });

  const error = await client.items.get("a").catch((caught) => caught);
  assert.equal(calls, 3);
  assert.ok(error instanceof TypeError);
});

test("non-idempotent POSTs without an idempotency key never retry", async () => {
  let calls = 0;
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: fastRetry,
    fetch: async () => {
      calls += 1;
      return new Response(null, { status: 500 });
    },
  });

  await assert.rejects(
    client.items.create({ source: { type: "text", text: "hello world" } }),
    OrbitApiError,
  );
  assert.equal(calls, 1);
});

test("bookmark saves carry an idempotency key, so they retry safely", async () => {
  let calls = 0;
  const client = new OrbitClient({
    baseUrl: "https://api.example.com/v2",
    apiPath: false,
    retry: fastRetry,
    fetch: async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 429 });
      return Response.json({ data: { id: "bookmark-1" } });
    },
  });

  const result = await client.bookmarks.createItem(
    { source: { type: "url", url: "https://example.com/story" }, title: "Story" },
    { idempotencyKey: "save-1" },
  );
  assert.equal(calls, 2);
  assert.equal(result.data?.id, "bookmark-1");
});

test("a 4xx never retries", async () => {
  let calls = 0;
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: fastRetry,
    fetch: async () => {
      calls += 1;
      return Response.json({ error: { code: "unauthorized", message: "Bad token." } }, { status: 401 });
    },
  });

  const error = await client.items.get("a").catch((caught) => caught);
  assert.ok(error instanceof OrbitApiError);
  assert.equal(error.isAuthError, true);
  assert.equal(calls, 1);
});

test("caller abort signals cancel the request and surface OrbitAbortError", async () => {
  const controller = new AbortController();
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: false,
    fetch: (input, init) => globalThis.fetch(input, init),
  });

  // Abort before dispatch so no real network request is attempted.
  controller.abort();
  await assert.rejects(
    client.items.get("a", { signal: controller.signal }),
    OrbitAbortError,
  );
});

test("caller aborts mid-flight are OrbitAbortError, not OrbitTimeoutError", async () => {
  const controller = new AbortController();
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: false,
    fetch: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });

  const pending = client.items.get("a", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, OrbitAbortError);
});

test("timeouts throw OrbitTimeoutError", async () => {
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: false,
    requestTimeoutMs: 10,
    fetch: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });

  await assert.rejects(client.items.get("a"), OrbitTimeoutError);
});

test("a callable apiKey is resolved per request so tokens can rotate", async () => {
  const seen: Array<string | null> = [];
  let token = "token-1";
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    apiKey: () => token,
    fetch: async (_input, init = {}) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return Response.json({ items: [] });
    },
  });

  await client.items.list();
  token = "token-2";
  await client.items.list();

  assert.deepEqual(seen, ["Bearer token-1", "Bearer token-2"]);
});

test("items.update PATCHes and items.delete DELETEs the item path", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    fetch: async (input, init = {}) => {
      requests.push({ url: String(input), method: init.method });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ schemaVersion: "orbit.item.v0", id: "item/1", ownerId: "u", source: { type: "url" }, createdAt: "2026-01-01T00:00:00.000Z" });
    },
  });

  await client.items.update("item/1", { note: "updated" });
  await client.items.delete("item/1");

  assert.deepEqual(requests, [
    { url: "https://api.example.com/orbit/v1/items/item%2F1", method: "PATCH" },
    { url: "https://api.example.com/orbit/v1/items/item%2F1", method: "DELETE" },
  ]);
});

test("items.iterate walks every page through the cursor", async () => {
  const cursors: Array<string | null> = [];
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    fetch: async (input) => {
      const url = new URL(String(input));
      const cursor = url.searchParams.get("cursor");
      cursors.push(cursor);
      if (!cursor) return Response.json({ items: [item("a"), item("b")], nextCursor: "b" });
      return Response.json({ items: [item("c")], nextCursor: null });
    },
  });

  const ids: string[] = [];
  for await (const entry of client.items.iterate({ pageSize: 2 })) ids.push(entry.id);

  assert.deepEqual(ids, ["a", "b", "c"]);
  assert.deepEqual(cursors, [null, "b"]);
});

test("QR wait survives transient poll failures but rethrows persistent ones", async () => {
  let calls = 0;
  const client = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: false,
    fetch: async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 503 });
      return Response.json({
        schemaVersion: "orbit.auth.qr_result.v0",
        sessionId: "s",
        status: "authorized",
      });
    },
  });

  const result = await client.auth.qr.waitForAuthorization(
    { sessionId: "s", code: "c" },
    { pollIntervalMs: 1 },
  );
  assert.equal(result.status, "authorized");
  assert.equal(calls, 2);

  const failing = new OrbitClient({
    baseUrl: "https://api.example.com",
    retry: false,
    fetch: async () =>
      Response.json({ error: { code: "not_found", message: "Unknown session." } }, { status: 404 }),
  });
  await assert.rejects(
    failing.auth.qr.waitForAuthorization({ sessionId: "s", code: "c" }, { pollIntervalMs: 1 }),
    OrbitApiError,
  );
});

function item(id: string) {
  return {
    schemaVersion: "orbit.item.v0",
    id,
    ownerId: "u",
    source: { type: "url", url: `https://example.com/${id}` },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
