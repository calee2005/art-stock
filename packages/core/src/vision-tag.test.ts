import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { addAssetTag, importAsset, PLACEHOLDER_WEBP } from "./assets.ts";
import { createHlcClock } from "./hlc.ts";
import { assetItemMetaKey, lockKey, visionTagSettingsKey } from "./keys.ts";
import { decodeJson } from "./json.ts";
import { MemoryObjectStore } from "./store.ts";
import type { AssetItem, LockDocument } from "./types.ts";
import {
  DEFAULT_VISION_TAG_PROMPT,
  allowVisionUpload,
  applyVisionGroups,
  buildVisionChatBody,
  createVisionTagQueue,
  defaultVisionProvider,
  defaultVisionTagSettings,
  drainVisionTagQueue,
  enqueueVisionTagJob,
  flattenVisionGroups,
  hashVisionPrompt,
  isVisionError,
  parseVisionTagJson,
  restorePresetPrompt,
  shouldEnqueueOnImport,
  tagAssetWithVision,
  visionSettingsHasSecrets,
  writeVisionTagSettings,
  type VisionChatClient,
} from "./vision-tag.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function device(store: MemoryObjectStore) {
  return { store, deviceId: "desk-a", deviceName: "desk-a", prefix: "" };
}

function groupsJson(overrides?: Record<string, string[]>): string {
  const tags = {
    视角: ["俯视"],
    构图: ["三分法"],
    色调: ["暖色调"],
    色彩: ["橙"],
    明暗关系: ["侧光"],
    角色: ["少女"],
    视觉元素: ["室内"],
    着装: ["连衣裙"],
    ...overrides,
  };
  return JSON.stringify({
    schemaVersion: 1,
    groups: [
      { dimension: "视角", tags: tags["视角"] },
      { dimension: "构图", tags: tags["构图"] },
      { dimension: "色调", tags: tags["色调"] },
      { dimension: "色彩", tags: tags["色彩"] },
      { dimension: "明暗关系", tags: tags["明暗关系"] },
      { dimension: "角色", tags: tags["角色"] },
      { dimension: "视觉元素", tags: tags["视觉元素"] },
      { dimension: "着装", tags: tags["着装"] },
    ],
  });
}

function mockClient(calls: unknown[], text = groupsJson()): VisionChatClient {
  return {
    async complete(request) {
      calls.push({
        endpoint: request.endpoint,
        model: request.model,
        hasKey: Boolean(request.apiKey),
        imagePrefix: request.imageJpegBase64.slice(0, 8),
      });
      assert.equal(JSON.stringify(request).includes(request.apiKey), true);
      return text;
    },
  };
}

test("preset prompt file matches DEFAULT_VISION_TAG_PROMPT", () => {
  const fromFile = readFileSync(
    join(here, "../prompts/asset-auto-tag.zh.md"),
    "utf8",
  ).replace(/\n$/, "");
  assert.equal(fromFile, DEFAULT_VISION_TAG_PROMPT);
  const fromDoc = readFileSync(
    join(here, "../../../docs/03-features/19-auto-tag.md"),
    "utf8",
  );
  const start = fromDoc.indexOf("```text\n") + "```text\n".length;
  const end = fromDoc.indexOf("\n```", start);
  assert.equal(fromDoc.slice(start, end), DEFAULT_VISION_TAG_PROMPT);
  const restored = restorePresetPrompt(defaultVisionTagSettings());
  assert.equal(restored.prompt, DEFAULT_VISION_TAG_PROMPT);
});

test("parseVisionTagJson accepts eight groups and flattens 视角/ prefixes", () => {
  const groups = parseVisionTagJson(groupsJson());
  assert.equal(groups.length, 8);
  assert.ok(flattenVisionGroups(groups).includes("视角/俯视"));
  assert.ok(flattenVisionGroups(groups).includes("构图/三分法"));
});

test("parseVisionTagJson rejects garbage as VISION_PARSE", () => {
  try {
    parseVisionTagJson("not json");
    assert.fail("expected parse error");
  } catch (error) {
    assert.equal(isVisionError(error), true);
    if (isVisionError(error)) {
      assert.equal(error.code, "VISION_PARSE");
    }
  }
});

test("applyVisionGroups keeps hand tags and replaces old vision tags", () => {
  const clock = createHlcClock("desk-a");
  const base: AssetItem = {
    schemaVersion: 1,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "hero.png",
    folderId: null,
    tags: ["主角A", "视角/仰视"],
    rating: 0,
    mimeType: "image/png",
    blobSha256: "abc",
    thumbKey: "assets/items/a/thumb.webp",
    visionTags: {
      groups: [
        { dimension: "视角", tags: ["仰视"] },
        { dimension: "构图", tags: [] },
        { dimension: "色调", tags: [] },
        { dimension: "色彩", tags: [] },
        { dimension: "明暗关系", tags: [] },
        { dimension: "角色", tags: [] },
        { dimension: "视觉元素", tags: [] },
        { dimension: "着装", tags: [] },
      ],
      model: "old",
      taggedAt: "2026-01-01T00:00:00.000Z",
      promptHash: "aa",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const next = applyVisionGroups(base, parseVisionTagJson(groupsJson()), {
    model: "DeepSeek-Flash",
    taggedAt: "2026-02-01T00:00:00.000Z",
    promptHash: "bb",
    clock,
    nowMs: 1,
  });
  assert.ok(next.tags.includes("主角A"));
  assert.ok(next.tags.includes("视角/俯视"));
  assert.equal(next.tags.includes("视角/仰视"), false);
  assert.equal(next.visionTags?.model, "DeepSeek-Flash");
});

test("no API key means import does not call the vision client", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const calls: unknown[] = [];
  const client = mockClient(calls);
  const item = await importAsset(remote, {
    name: "hero.png",
    bytes: PNG_1X1,
    mimeType: "image/png",
    thumbBytes: PLACEHOLDER_WEBP,
  });
  const settings = defaultVisionTagSettings({ enabled: true });
  settings.enabled = true;
  assert.equal(
    shouldEnqueueOnImport({
      settings,
      hasApiKey: false,
      item,
    }),
    false,
  );
  assert.equal(calls.length, 0);
  assert.equal(item.tags.length, 0);
});

test("tagAssetWithVision writes flattened tags under withRemoteLock", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const item = await importAsset(remote, {
    name: "hero.png",
    bytes: PNG_1X1,
    mimeType: "image/png",
    thumbBytes: PLACEHOLDER_WEBP,
  });
  await addAssetTag(remote, item.id, "主角A");
  const calls: unknown[] = [];
  let lockSeen = false;
  const origPut = store.put.bind(store);
  store.put = async (key, body, options) => {
    if (key === assetItemMetaKey("", item.id) && key.endsWith("meta.json")) {
      const held = await store.get(lockKey(""));
      if (held) {
        lockSeen = true;
      }
    }
    return origPut(key, body, options);
  };
  const settings = defaultVisionTagSettings({ enabled: true });
  settings.enabled = true;
  const tagged = await tagAssetWithVision(
    remote,
    item.id,
    {
      provider: defaultVisionProvider({ apiKey: "sk-test-not-for-git" }),
      settings,
      jpegBytes: PNG_1X1,
      client: mockClient(calls),
      network: "wifi",
    },
  );
  assert.equal(lockSeen, true);
  assert.equal(await store.get(lockKey("")), null);
  assert.ok(tagged.tags.includes("主角A"));
  assert.ok(tagged.tags.includes("视角/俯视"));
  assert.equal(calls.length, 1);
  const stored = decodeJson((await store.get(assetItemMetaKey("", item.id)))!.body) as AssetItem;
  assert.ok(stored.tags.includes("视角/俯视"));
  assert.equal(JSON.stringify(stored).includes("sk-test-not-for-git"), false);
});

test("wifiOnly blocks cellular uploads before the client is called", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const item = await importAsset(remote, {
    name: "hero.png",
    bytes: PNG_1X1,
    mimeType: "image/png",
    thumbBytes: PLACEHOLDER_WEBP,
  });
  const calls: unknown[] = [];
  const settings = defaultVisionTagSettings({ enabled: true, wifiOnly: true });
  settings.enabled = true;
  settings.sendImage.wifiOnly = true;
  assert.equal(allowVisionUpload(true, "cellular"), false);
  try {
    await tagAssetWithVision(remote, item.id, {
      provider: defaultVisionProvider({ apiKey: "sk-test-not-for-git" }),
      settings,
      jpegBytes: PNG_1X1,
      client: mockClient(calls),
      network: "cellular",
    });
    assert.fail("expected wifi-only error");
  } catch (error) {
    assert.equal(isVisionError(error), true);
    if (isVisionError(error)) {
      assert.equal(error.code, "VISION_WIFI_ONLY");
    }
  }
  assert.equal(calls.length, 0);
});

test("writeVisionTagSettings holds lock and never stores apiKey", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  let lockSeen = false;
  const origPut = store.put.bind(store);
  store.put = async (key, body, options) => {
    if (key === visionTagSettingsKey("")) {
      const held = await store.get(lockKey(""));
      lockSeen = Boolean(held);
      if (held) {
        assert.equal((decodeJson(held.body) as LockDocument).purpose, "sync");
      }
    }
    return origPut(key, body, options);
  };
  const settings = defaultVisionTagSettings({ enabled: true });
  settings.enabled = true;
  settings.prompt = DEFAULT_VISION_TAG_PROMPT;
  const written = await writeVisionTagSettings(remote, {
    ...settings,
    ...({ apiKey: "sk-leaked" } as unknown as Record<string, unknown>),
  } as never);
  assert.equal(lockSeen, true);
  assert.equal(visionSettingsHasSecrets(written), false);
  const raw = new TextDecoder().decode((await store.get(visionTagSettingsKey("")))!.body);
  assert.equal(raw.includes("sk-leaked"), false);
  assert.equal(raw.includes("apiKey"), false);
});

test("chat body is openai-compatible and queue runs serially", async () => {
  const body = buildVisionChatBody({
    model: "DeepSeek-Flash",
    systemPrompt: "sys",
    imageJpegBase64: "abc",
  });
  assert.equal(body.temperature, 0.2);
  assert.equal((body.response_format as { type: string }).type, "json_object");
  const messages = body.messages as { role: string }[];
  assert.equal(messages[0]?.role, "system");
  const queue = createVisionTagQueue();
  const order: string[] = [];
  enqueueVisionTagJob(queue, { assetId: "a" });
  enqueueVisionTagJob(queue, { assetId: "b" });
  await drainVisionTagQueue(queue, async (job) => {
    order.push(`start-${job.assetId}`);
    await Promise.resolve();
    order.push(`end-${job.assetId}`);
  });
  assert.deepEqual(order, ["start-a", "end-a", "start-b", "end-b"]);
});

test("hashVisionPrompt is stable for the preset", async () => {
  const a = await hashVisionPrompt(DEFAULT_VISION_TAG_PROMPT);
  const b = await hashVisionPrompt(DEFAULT_VISION_TAG_PROMPT);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});
