import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LocalOrbitStore } from "../src/index.js";

const schemaDir = fileURLToPath(new URL("../../../specs/schemas/", import.meta.url));

function loadValidator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats.default(ajv);
  for (const file of [
    "orbit-resource.schema.json",
    "orbit-item.schema.json",
    "orbit-evidence.schema.json",
    "orbit-user-fact.schema.json",
    "orbit-relation.schema.json",
  ]) {
    ajv.addSchema(JSON.parse(readFileSync(`${schemaDir}${file}`, "utf8")));
  }
  return ajv.getSchema(`https://orbit.dev/schemas/${name}`)!;
}

test("LocalOrbitStore items conform to the published item schema", async () => {
  const validate = loadValidator("orbit-item.schema.json");
  const store = new LocalOrbitStore();
  const item = await store.putItem({
    ownerId: "user_raj",
    source: { type: "url", url: "https://example.com/tokyo-cafe", platform: "web" },
    title: "Quiet Tokyo cafe",
    summary: "A cafe in Shimokitazawa with matcha lattes and late hours.",
    tags: ["tokyo", "cafe"],
    resources: [{
      name: "Neko Cafe",
      type: "Place",
      geo: { latitude: 35.6613, longitude: 139.6665, precision: "approximate" },
      address: { locality: "Tokyo", country: "Japan", countryCode: "JP" },
    }],
  });

  assert.equal(validate(JSON.parse(JSON.stringify(item))), true, JSON.stringify(validate.errors, null, 2));
});

test("LocalOrbitStore evidence chunks conform to the published evidence schema", async () => {
  const validate = loadValidator("orbit-evidence.schema.json");
  const store = new LocalOrbitStore();
  const item = await store.putItem({
    ownerId: "user_raj",
    source: { type: "url", url: "https://example.com/story" },
    title: "Story",
    summary: "A long-enough summary for indexing.",
    note: "Personal note about the story.",
    entities: { topics: ["stories"] },
  });
  const chunks = await store.indexItem(item.id, item.ownerId);

  assert.ok(chunks.length > 0);
  for (const chunk of chunks) {
    assert.equal(validate(JSON.parse(JSON.stringify(chunk))), true, JSON.stringify(validate.errors, null, 2));
  }
});

test("LocalOrbitStore user facts conform to the published user-fact schema", async () => {
  const validate = loadValidator("orbit-user-fact.schema.json");
  const store = new LocalOrbitStore();
  const fact = await store.upsertUserFact({
    ownerId: "user_raj",
    content: "Prefers matcha over coffee.",
    source: "conversation",
    confidence: 0.9,
  });

  assert.equal(validate(JSON.parse(JSON.stringify(fact))), true, JSON.stringify(validate.errors, null, 2));
});
