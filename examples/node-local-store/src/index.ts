import { LocalOrbitStore } from "@orbb/orbit-sdk";

const store = new LocalOrbitStore();

const rajCafe = await store.putItem({
  ownerId: "user_raj",
  source: {
    type: "url",
    url: "https://example.com/tokyo-cafe",
    platform: "web",
  },
  title: "Quiet Tokyo cafe",
  summary: "A quiet cafe in Shimokitazawa with matcha lattes and late hours.",
  tags: ["tokyo", "cafe", "travel"],
  entities: {
    places: ["Tokyo", "Shimokitazawa"],
    topics: ["coffee", "quiet cafes"],
  },
  resources: [
    {
      name: "Shimokitazawa",
      type: "Place",
      searchQuery: "quiet cafe Shimokitazawa Tokyo",
      geo: {
        latitude: 35.6613,
        longitude: 139.6665,
        precision: "approximate",
        source: "example",
      },
      address: {
        label: "Shimokitazawa, Setagaya City, Tokyo, Japan",
        locality: "Tokyo",
        country: "Japan",
        countryCode: "JP",
      },
    },
  ],
});

const rajRamen = await store.putItem({
  ownerId: "user_raj",
  source: {
    type: "text",
    text: "Late night ramen counter near Shinjuku station.",
  },
  title: "Shinjuku ramen",
  summary: "A casual ramen place near Shinjuku that is open late.",
  tags: ["tokyo", "food"],
  entities: {
    places: ["Tokyo", "Shinjuku"],
    topics: ["ramen", "late night food"],
  },
});

const alexBike = await store.putItem({
  ownerId: "user_alex",
  source: {
    type: "url",
    url: "https://example.com/berlin-cycling",
    platform: "web",
  },
  title: "Berlin cycling routes",
  summary: "A guide to calm cycling routes through Kreuzberg and Tempelhofer Feld.",
  tags: ["berlin", "cycling"],
  entities: {
    places: ["Berlin", "Kreuzberg"],
    topics: ["cycling", "quiet routes"],
  },
});

await Promise.all([
  store.indexItem(rajCafe.id, rajCafe.ownerId),
  store.indexItem(rajRamen.id, rajRamen.ownerId),
  store.indexItem(alexBike.id, alexBike.ownerId),
]);

const rajResults = await store.searchEvidence({
  ownerId: "user_raj",
  query: "quiet cafes in Tokyo",
  limit: 5,
});

const alexResults = await store.searchEvidence({
  ownerId: "user_alex",
  query: "quiet cafes in Tokyo",
  limit: 5,
});

console.log("Raj namespace results:");
for (const result of rajResults) {
  console.log(`- ${result.item.itemId} | ${result.item.kind} | score=${result.score.toFixed(3)}`);
  console.log(`  ${result.item.text}`);
}

console.log("\nAlex namespace results:");
for (const result of alexResults) {
  console.log(`- ${result.item.itemId} | ${result.item.kind} | score=${result.score.toFixed(3)}`);
  console.log(`  ${result.item.text}`);
}

console.log("\nSeparate owner namespaces:");
console.log("- user_raj searched only user_raj evidence records");
console.log("- user_alex searched only user_alex evidence records");
