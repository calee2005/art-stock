import { test } from "node:test";
import assert from "node:assert/strict";
import { assetKind, countAssetKinds, formatLabel, matchesFormat } from "./media.ts";
import { childNodes } from "./tree-util.ts";
import type { TreeNode } from "@art-stock/core";

test("classifies image video model and other", () => {
  assert.equal(assetKind("image/jpeg", "a.jpg"), "image");
  assert.equal(assetKind("application/octet-stream", "hero.psd"), "image");
  assert.equal(assetKind("video/mp4", "clip.mp4"), "video");
  assert.equal(assetKind("model/gltf-binary", "char.glb"), "model");
  assert.equal(assetKind("application/zip", "pack.zip"), "other");
});

test("counts kinds and matches jpg chip", () => {
  const counts = countAssetKinds([
    { mimeType: "image/jpeg", name: "a.jpg" },
    { mimeType: "image/png", name: "b.png" },
    { mimeType: "video/mp4", name: "c.mp4" },
  ]);
  assert.equal(counts.image, 2);
  assert.equal(counts.video, 1);
  assert.equal(formatLabel("image/jpeg", "a.jpeg"), "JPG");
  assert.ok(matchesFormat("image/jpeg", "a.jpg", "JPG"));
});

test("folder children sort by order under a parent", () => {
  const nodes: TreeNode[] = [
    {
      id: "f",
      parentId: null,
      kind: "folder",
      name: "画稿",
      tags: [],
      updatedAt: "",
      order: 1,
    },
    {
      id: "a",
      parentId: "f",
      kind: "file",
      name: "b.psd",
      tags: [],
      updatedAt: "",
      order: 2,
    },
    {
      id: "b",
      parentId: "f",
      kind: "file",
      name: "a.psd",
      tags: [],
      updatedAt: "",
      order: 1,
    },
  ];
  assert.deepEqual(
    childNodes(nodes, "f").map((node) => node.id),
    ["b", "a"],
  );
});
