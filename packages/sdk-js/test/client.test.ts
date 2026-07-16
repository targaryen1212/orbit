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

  await client.bookmarks.createMemory({
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
    category: "bookmark",
    type: "url",
    isTextOnly: false,
    details: { searchableText: "Story" },
  });
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

  await client.bookmarks.createMemory({
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
