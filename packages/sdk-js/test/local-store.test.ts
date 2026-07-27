import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LocalOrbitStore,
  OrbitClient,
  normalizeOrbitBaseUrl,
} from "../src/index.js";
import type { OrbitItem } from "../src/index.js";

describe("LocalOrbitStore", () => {
  it("searches only inside the requested owner namespace", async () => {
    const store = new LocalOrbitStore();

    const rajItem = await putIndexedItem(store, {
      ownerId: "user_raj",
      title: "Tokyo cafe",
      summary: "A quiet cafe in Shimokitazawa with matcha lattes.",
      tags: ["tokyo", "cafe"],
      entities: { places: ["Tokyo"] },
    });
    const alexItem = await putIndexedItem(store, {
      ownerId: "user_alex",
      title: "Berlin cafe",
      summary: "A quiet cafe in Kreuzberg with late hours.",
      tags: ["berlin", "cafe"],
      entities: { places: ["Berlin"] },
    });

    const rajResults = await store.searchEvidence({
      ownerId: "user_raj",
      query: "quiet cafe",
      limit: 10,
    });
    const alexResults = await store.searchEvidence({
      ownerId: "user_alex",
      query: "quiet cafe",
      limit: 10,
    });

    assert(rajResults.length > 0);
    assert(alexResults.length > 0);
    assert(rajResults.every((result) => result.item.ownerId === "user_raj"));
    assert(alexResults.every((result) => result.item.ownerId === "user_alex"));
    assert(rajResults.every((result) => result.item.itemId !== alexItem.id));
    assert(alexResults.every((result) => result.item.itemId !== rajItem.id));
  });

  it("applies tag, entity, source type, category, and created-at filters", async () => {
    const store = new LocalOrbitStore();

    const travelItem = await putIndexedItem(store, {
      ownerId: "user_raj",
      title: "Tokyo itinerary",
      summary: "A slow travel guide for quiet Tokyo cafes.",
      source: { type: "url", url: "https://example.com/tokyo" },
      tags: ["tokyo", "travel"],
      entities: { places: ["Tokyo"], topics: ["cafes"] },
      metadata: { category: "travel" },
      createdAt: "2026-01-10T00:00:00.000Z",
    });
    await putIndexedItem(store, {
      ownerId: "user_raj",
      title: "Ramen note",
      summary: "A food note about ramen near Shinjuku.",
      source: { type: "note", text: "Ramen near Shinjuku" },
      tags: ["tokyo", "food"],
      entities: { places: ["Tokyo"], topics: ["ramen"] },
      metadata: { category: "food" },
      createdAt: "2025-12-01T00:00:00.000Z",
    });

    const results = await store.searchEvidence({
      ownerId: "user_raj",
      query: "quiet Tokyo cafes",
      filters: {
        tags: ["travel"],
        entities: { places: ["tokyo"], topics: ["cafes"] },
        sourceTypes: ["url"],
        category: "travel",
        createdAfter: "2026-01-01T00:00:00.000Z",
        createdBefore: "2026-02-01T00:00:00.000Z",
      },
      limit: 10,
    });

    assert(results.length > 0);
    assert(results.every((result) => result.item.itemId === travelItem.id));
  });

  it("does not index source fields listed in item privacy redaction", async () => {
    const store = new LocalOrbitStore();
    const item = await store.putItem({
      ownerId: "user_raj",
      source: { type: "text", text: "public launch notes" },
      title: "Launch notes",
      summary: "harbor-secret-token",
      note: "shareable planning note",
      content: {
        transcript: "vault-passphrase",
      },
      privacy: {
        scope: "private",
        redaction: ["summary", "content.transcript"],
      },
    });

    const chunks = await store.indexItem(item.id, item.ownerId);
    const redactedResults = await store.searchEvidence({
      ownerId: "user_raj",
      query: "harbor-secret-token vault-passphrase",
    });
    const noteResults = await store.searchEvidence({
      ownerId: "user_raj",
      query: "shareable planning note",
    });

    assert(chunks.every((chunk) => !chunk.sourceFields.includes("content.transcript")));
    assert(chunks.every((chunk) => !chunk.text.includes("harbor-secret-token")));
    assert(chunks.every((chunk) => !chunk.text.includes("vault-passphrase")));
    assert.deepEqual(redactedResults, []);
    assert(noteResults.length > 0);
  });

  it("deletes an item together with its derived evidence", async () => {
    const store = new LocalOrbitStore();
    const item = await putIndexedItem(store, {
      ownerId: "user_raj",
      title: "Tokyo cafe",
      summary: "A quiet cafe in Shimokitazawa.",
    });

    const deleted = await store.deleteItem(item.id, item.ownerId);
    const items = await store.listItems(item.ownerId);
    const results = await store.searchEvidence({ ownerId: item.ownerId, query: "quiet cafe" });

    assert.equal(deleted, true);
    assert.deepEqual(items, []);
    assert.deepEqual(results, []);
  });

  it("updates mutable fields and drops stale evidence until re-indexed", async () => {
    const store = new LocalOrbitStore();
    const item = await putIndexedItem(store, {
      ownerId: "user_raj",
      title: "Tokyo cafe",
      summary: "A quiet cafe in Shimokitazawa.",
    });

    const updated = await store.updateItem(item.id, item.ownerId, {
      note: "Visited last spring.",
      tags: ["tokyo", "cafe"],
    });
    const staleResults = await store.searchEvidence({ ownerId: item.ownerId, query: "quiet cafe" });
    await store.indexItem(item.id, item.ownerId);
    const freshResults = await store.searchEvidence({ ownerId: item.ownerId, query: "visited spring" });

    assert.equal(updated?.note, "Visited last spring.");
    assert.deepEqual(updated?.tags, ["tokyo", "cafe"]);
    assert.equal(updated?.title, "Tokyo cafe");
    assert.deepEqual(staleResults, []);
    assert(freshResults.length > 0);
    assert.equal(await store.updateItem("missing", item.ownerId, { note: "x" }), null);
  });

  it("finds non-Latin content in local search", async () => {
    const store = new LocalOrbitStore();
    await putIndexedItem(store, {
      ownerId: "user_raj",
      title: "下北沢のカフェ",
      summary: "下北沢にある静かなカフェで、抹茶ラテがおいしい。",
    });

    const results = await store.searchEvidence({
      ownerId: "user_raj",
      query: "静かなカフェ",
    });

    assert(results.length > 0);
  });

});

describe("OrbitClient", () => {
  it("normalizes protocol base URLs without duplicating /orbit/v1", () => {
    assert.equal(normalizeOrbitBaseUrl("https://api.example.com"), "https://api.example.com/orbit/v1");
    assert.equal(
      normalizeOrbitBaseUrl("https://api.example.com/orbit/v1/"),
      "https://api.example.com/orbit/v1"
    );
    assert.equal(
      normalizeOrbitBaseUrl("https://api.example.com/custom", "/item/v2"),
      "https://api.example.com/custom/item/v2"
    );
    assert.equal(
      normalizeOrbitBaseUrl("https://api.example.com/custom/", false),
      "https://api.example.com/custom"
    );
  });

  it("requests items through the default /orbit/v1 path", async () => {
    const requests: Array<{ url: string; body?: string | null }> = [];
    const client = new OrbitClient({
      baseUrl: "https://api.example.com",
      fetch: (async (url, init) => {
        requests.push({ url: String(url), body: init?.body?.toString() });
        if (String(url).endsWith("/items?limit=2")) return jsonResponse({ items: [] });
        return jsonResponse({
          schemaVersion: "orbit.item.v0",
          id: "item_1",
          ownerId: "user_from_auth",
          source: { type: "text", text: "created by authenticated user" },
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }) as typeof fetch,
    });

    await client.items.list({ limit: 2 });
    await client.items.create({
      source: { type: "text", text: "created by authenticated user" },
      summary: "The server supplies the owner from authentication.",
    });

    assert.equal(requests[0].url, "https://api.example.com/orbit/v1/items?limit=2");
    assert.equal(requests[1].url, "https://api.example.com/orbit/v1/items");
    assert(!JSON.parse(requests[1].body ?? "{}").ownerId);
  });
});

async function putIndexedItem(
  store: LocalOrbitStore,
  input: Partial<Parameters<LocalOrbitStore["putItem"]>[0]> & Pick<OrbitItem, "ownerId">
): Promise<OrbitItem> {
  const item = await store.putItem({
    ownerId: input.ownerId,
    source: input.source ?? { type: "text", text: input.summary ?? input.title ?? "Local item" },
    title: input.title,
    summary: input.summary,
    tags: input.tags,
    entities: input.entities,
    metadata: input.metadata,
    createdAt: input.createdAt,
  });
  await store.indexItem(item.id, item.ownerId);
  return item;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
