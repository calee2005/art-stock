import assert from "node:assert/strict";
import { test } from "node:test";
import {
  rebuildAssetSearchIndex,
  searchAssetIndex,
  searchAssets,
} from "./search.ts";

const docs = [
  { id: "a", name: "hero.png", tags: ["角色", "main"] },
  { id: "b", name: "villain.png", tags: ["反派"] },
  { id: "c", name: "prop-sword.png", tags: ["道具", "角色"] },
];

test("MiniSearch finds assets by name and by tag", () => {
  const byName = searchAssets(docs, "hero");
  assert.deepEqual(
    byName.map((item) => item.id),
    ["a"],
  );
  const byTag = searchAssets(docs, "角色");
  assert.deepEqual(
    byTag.map((item) => item.id).sort(),
    ["a", "c"],
  );
  const andQuery = searchAssets(docs, "hero 角色");
  assert.deepEqual(
    andQuery.map((item) => item.id),
    ["a"],
  );
  const miss = searchAssets(docs, "xyz");
  assert.equal(miss.length, 0);
  const prefix = searchAssets(docs, "her");
  assert.deepEqual(
    prefix.map((item) => item.id),
    ["a"],
  );
});

test("SQLite FTS MATCH is AND of terms; prefix needs *", () => {
  const index = rebuildAssetSearchIndex(docs, "sqlite-fts");
  assert.deepEqual(searchAssetIndex(index, "villain").sort(), ["b"]);
  assert.deepEqual(searchAssetIndex(index, "角色").sort(), ["a", "c"]);
  assert.deepEqual(searchAssetIndex(index, "prop 角色"), ["c"]);
  assert.deepEqual(searchAssetIndex(index, "her"), []);
  assert.deepEqual(searchAssetIndex(index, "her*"), ["a"]);
});
