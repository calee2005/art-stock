import { encodeJson, decodeJson } from "./json.ts";
import { sha256Hex } from "./hash.ts";
import { assetItemMetaKey, blobKey, lockKey, visionTagSettingsKey } from "./keys.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import { createHlcClock, tickHlc, type HlcClock } from "./hlc.ts";
import { addToOrSet, removeFromOrSet } from "./orset.ts";
import { applyTagSet, tagSetOf } from "./tags.ts";
import { DEFAULT_VISION_TAG_PROMPT } from "./vision-prompt.ts";
import {
  SCHEMA_VERSION,
  type AssetItem,
  type Hlc,
  type VisionProviderConfig,
  type VisionTagGroup,
  type VisionTagSettings,
  type VisionTags,
} from "./types.ts";
import type { NetworkKind } from "./pin.ts";
import type { ObjectStore } from "./store.ts";

export { DEFAULT_VISION_TAG_PROMPT } from "./vision-prompt.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

export const VISION_DIMENSIONS = [
  "视角",
  "构图",
  "色调",
  "色彩",
  "明暗关系",
  "角色",
  "视觉元素",
  "着装",
] as const;

export type VisionDimension = (typeof VISION_DIMENSIONS)[number];

const DIMENSION_SET = new Set<string>(VISION_DIMENSIONS);

export const DEFAULT_VISION_ENDPOINT =
  "https://api.deepseek.com/v1/chat/completions";
export const DEFAULT_VISION_MODEL = "DeepSeek-Flash";

export const VISION_USER_TEXT = "请为这张图打标签。";

const SECRET_FIELD_RE = /secretAccessKey|accessKeyId|apiKey|api_key|secret_access_key/i;

export type VisionErrorCode =
  | "VISION_PARSE"
  | "VISION_HTTP"
  | "VISION_CORS"
  | "VISION_NO_KEY"
  | "VISION_WIFI_ONLY"
  | "VISION_NOT_RASTER"
  | "VISION_DISABLED";

export class VisionError extends Error {
  readonly code: VisionErrorCode;

  constructor(code: VisionErrorCode, message: string) {
    super(message);
    this.name = "VisionError";
    this.code = code;
  }
}

export function isVisionError(error: unknown): error is VisionError {
  return error instanceof VisionError;
}

export function defaultVisionProvider(
  fields?: Partial<VisionProviderConfig>,
): VisionProviderConfig {
  return {
    id: fields?.id ?? "deepseek",
    name: fields?.name ?? "DeepSeek",
    endpoint: fields?.endpoint ?? DEFAULT_VISION_ENDPOINT,
    model: fields?.model ?? DEFAULT_VISION_MODEL,
    apiKey: fields?.apiKey ?? "",
    apiStyle: "openai-chat-completions",
  };
}

export function defaultVisionTagSettings(input?: {
  now?: Date;
  wifiOnly?: boolean;
  enabled?: boolean;
}): VisionTagSettings {
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: input?.enabled ?? false,
    triggers: {
      onImport: true,
      onImportOnlyIfEmpty: false,
    },
    sendImage: {
      maxEdgePx: 1024,
      jpegQuality: 0.85,
      wifiOnly: input?.wifiOnly ?? false,
    },
    prompt: "",
    updatedAt: (input?.now ?? new Date()).toISOString(),
  };
}

export function effectiveVisionPrompt(settings: Pick<VisionTagSettings, "prompt">): string {
  const trimmed = settings.prompt.trim();
  return trimmed.length > 0 ? settings.prompt : DEFAULT_VISION_TAG_PROMPT;
}

export function restorePresetPrompt(settings: VisionTagSettings): VisionTagSettings {
  return { ...settings, prompt: DEFAULT_VISION_TAG_PROMPT };
}

export async function hashVisionPrompt(prompt: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(prompt));
}

export function promptHashShort(hash: string): string {
  return hash.slice(0, 8);
}

export function visionSettingsHasSecrets(value: unknown): boolean {
  if (value && typeof value === "object" && "apiKey" in (value as object)) {
    return true;
  }
  return SECRET_FIELD_RE.test(JSON.stringify(value));
}

export function assertVisionSettingsNoSecrets(value: unknown): void {
  if (visionSettingsHasSecrets(value)) {
    throw new Error("vision-tag.json must not contain API keys");
  }
}

export function sanitizeVisionTagSettings(
  value: Partial<VisionTagSettings> & Record<string, unknown>,
  fallbackWifiOnly = false,
): VisionTagSettings {
  const base = defaultVisionTagSettings({ wifiOnly: fallbackWifiOnly });
  const triggers = value.triggers ?? base.triggers;
  const sendImage = value.sendImage ?? base.sendImage;
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: Boolean(value.enabled),
    providerId: typeof value.providerId === "string" ? value.providerId : undefined,
    triggers: {
      onImport: Boolean(triggers.onImport),
      onImportOnlyIfEmpty: Boolean(triggers.onImportOnlyIfEmpty),
    },
    sendImage: {
      maxEdgePx: Number(sendImage.maxEdgePx) > 0 ? Number(sendImage.maxEdgePx) : 1024,
      jpegQuality:
        Number(sendImage.jpegQuality) > 0 && Number(sendImage.jpegQuality) <= 1
          ? Number(sendImage.jpegQuality)
          : 0.85,
      wifiOnly: Boolean(sendImage.wifiOnly),
    },
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

const RASTER_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const RASTER_EXT = /\.(jpe?g|png|webp|gif)$/i;

export function isRasterAsset(item: { mimeType?: string; name?: string }): boolean {
  const mime = (item.mimeType ?? "").toLowerCase();
  if (RASTER_MIME.has(mime)) {
    return true;
  }
  return RASTER_EXT.test(item.name ?? "");
}

export function allowVisionUpload(
  wifiOnly: boolean,
  network: NetworkKind,
): boolean {
  if (network === "offline") {
    return false;
  }
  if (!wifiOnly) {
    return true;
  }
  return network === "wifi";
}

export function shouldEnqueueOnImport(input: {
  settings: VisionTagSettings;
  hasApiKey: boolean;
  item: Pick<AssetItem, "tags" | "mimeType" | "name">;
}): boolean {
  if (!input.hasApiKey || !input.settings.enabled) {
    return false;
  }
  if (!input.settings.triggers.onImport) {
    return false;
  }
  if (!isRasterAsset(input.item)) {
    return false;
  }
  if (input.settings.triggers.onImportOnlyIfEmpty && input.item.tags.length > 0) {
    return false;
  }
  return true;
}

export function needsUntaggedScan(item: Pick<AssetItem, "tags" | "visionTags" | "mimeType" | "name">): boolean {
  if (!isRasterAsset(item)) {
    return false;
  }
  return !item.visionTags || item.tags.length === 0;
}

const TAG_PUNCT_END = /[。．.!?！？；;，,、]$/;

export function sanitizeVisionTag(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const tag = raw.trim().replace(TAG_PUNCT_END, "");
  if (tag.length < 2 || tag.length > 16) {
    return null;
  }
  if (/^无$|^未知$/.test(tag)) {
    return null;
  }
  return tag;
}

function emptyGroups(): VisionTagGroup[] {
  return VISION_DIMENSIONS.map((dimension) => ({ dimension, tags: [] }));
}

export function parseVisionTagJson(text: string): VisionTagGroup[] {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new VisionError("VISION_PARSE", "模型返回不是合法 JSON");
  }
  if (!parsed || typeof parsed !== "object" || !("groups" in parsed)) {
    throw new VisionError("VISION_PARSE", "模型返回缺少 groups");
  }
  const rawGroups = (parsed as { groups: unknown }).groups;
  if (!Array.isArray(rawGroups)) {
    throw new VisionError("VISION_PARSE", "groups 必须是数组");
  }
  const byDimension = new Map<string, string[]>();
  for (const row of rawGroups) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const dimension = String((row as VisionTagGroup).dimension ?? "");
    if (!DIMENSION_SET.has(dimension)) {
      continue;
    }
    const tags: string[] = [];
    const rawTags = (row as VisionTagGroup).tags;
    if (Array.isArray(rawTags)) {
      for (const item of rawTags) {
        const tag = sanitizeVisionTag(item);
        if (tag && !tags.includes(tag)) {
          tags.push(tag);
        }
        if (tags.length >= 8) {
          break;
        }
      }
    }
    byDimension.set(dimension, tags);
  }
  const seen = new Set<string>();
  return emptyGroups().map((group) => {
    const tags: string[] = [];
    for (const tag of byDimension.get(group.dimension) ?? []) {
      if (seen.has(tag)) {
        continue;
      }
      seen.add(tag);
      tags.push(tag);
    }
    return { dimension: group.dimension, tags };
  });
}

export function flattenVisionGroups(groups: readonly VisionTagGroup[]): string[] {
  const out: string[] = [];
  for (const group of groups) {
    for (const tag of group.tags) {
      out.push(`${group.dimension}/${tag}`);
    }
  }
  return out;
}

export function isVisionFlatTag(tag: string): boolean {
  const slash = tag.indexOf("/");
  if (slash <= 0) {
    return false;
  }
  return DIMENSION_SET.has(tag.slice(0, slash));
}

export function visionFlatTagsOf(item: Pick<AssetItem, "tags" | "visionTags">): string[] {
  if (item.visionTags) {
    return flattenVisionGroups(item.visionTags.groups);
  }
  return item.tags.filter(isVisionFlatTag);
}

export function applyVisionGroups(
  item: AssetItem,
  groups: VisionTagGroup[],
  meta: {
    model: string;
    taggedAt: string;
    promptHash: string;
    clock: HlcClock;
    nowMs: number;
  },
): AssetItem {
  const previous = new Set(visionFlatTagsOf(item));
  const removeHlc = tickHlc(meta.clock, meta.nowMs);
  let set = tagSetOf(item);
  for (const tag of previous) {
    set = removeFromOrSet(set, tag, removeHlc);
  }
  const addHlc = tickHlc(meta.clock, meta.nowMs);
  for (const tag of flattenVisionGroups(groups)) {
    set = addToOrSet(set, tag, addHlc);
  }
  const visionTags: VisionTags = {
    groups,
    model: meta.model,
    taggedAt: meta.taggedAt,
    promptHash: meta.promptHash,
  };
  const updated = applyTagSet(item, set);
  updated.visionTags = visionTags;
  updated.updatedAt = meta.taggedAt;
  return updated;
}

export function removeOneVisionTag(
  item: AssetItem,
  flatTag: string,
  hlc: Hlc,
  nowIso: string,
): AssetItem {
  let set = removeFromOrSet(tagSetOf(item), flatTag, hlc);
  const updated = applyTagSet(item, set);
  if (updated.visionTags) {
    const slash = flatTag.indexOf("/");
    const dimension = flatTag.slice(0, slash);
    const value = flatTag.slice(slash + 1);
    updated.visionTags = {
      ...updated.visionTags,
      groups: updated.visionTags.groups.map((group) =>
        group.dimension === dimension
          ? { ...group, tags: group.tags.filter((tag) => tag !== value) }
          : group,
      ),
    };
  }
  updated.updatedAt = nowIso;
  return updated;
}

export async function readVisionTagSettings(
  store: ObjectStore,
  prefix: string,
): Promise<VisionTagSettings | null> {
  const got = await store.get(visionTagSettingsKey(prefix));
  if (!got) {
    return null;
  }
  const parsed = decodeJson(got.body) as Partial<VisionTagSettings> & Record<string, unknown>;
  assertVisionSettingsNoSecrets(parsed);
  return sanitizeVisionTagSettings(parsed);
}

export type VisionWriteOptions = WithRemoteLockOptions & {
  clock?: HlcClock;
  nowMs?: number;
};

export async function writeVisionTagSettings(
  remote: RemoteLockTarget,
  settings: VisionTagSettings,
  options?: WithRemoteLockOptions,
): Promise<VisionTagSettings> {
  const sanitized = sanitizeVisionTagSettings(settings, settings.sendImage.wifiOnly);
  sanitized.updatedAt = new Date().toISOString();
  assertVisionSettingsNoSecrets(sanitized);
  const prefix = remote.prefix ?? "";
  const key = visionTagSettingsKey(prefix);
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const existing = await remote.store.get(key);
      await remote.store.put(key, encodeJson(sanitized), {
        contentType: "application/json",
        ...(existing ? { ifMatch: existing.etag } : { ifNoneMatch: "*" }),
      });
      return sanitized;
    },
    lockOpts(options),
  );
}

export function bytesToBase64(bytes: Uint8Array): string {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out += table[(triple >> 18) & 63];
    out += table[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? table[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? table[triple & 63] : "=";
  }
  return out;
}

export type VisionChatRequest = {
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  imageJpegBase64: string;
};

export type VisionChatClient = {
  complete(request: VisionChatRequest): Promise<string>;
};

export function buildVisionChatBody(request: Omit<VisionChatRequest, "endpoint" | "apiKey">): Record<string, unknown> {
  return {
    model: request.model,
    temperature: 0.2,
    max_tokens: 1500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: request.systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: VISION_USER_TEXT },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${request.imageJpegBase64}` },
          },
        ],
      },
    ],
  };
}

function redact(text: string, apiKey: string): string {
  if (!apiKey) {
    return text;
  }
  return text.split(apiKey).join("[redacted]");
}

export function createOpenAiVisionClient(input?: {
  fetch?: typeof fetch;
}): VisionChatClient {
  const fetchImpl = input?.fetch ?? fetch;
  return {
    async complete(request) {
      let response: Response;
      try {
        response = await fetchImpl(request.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${request.apiKey}`,
          },
          body: JSON.stringify(buildVisionChatBody(request)),
        });
      } catch (error) {
        const message = redact(error instanceof Error ? error.message : String(error), request.apiKey);
        if (/failed to fetch|cors|networkerror/i.test(message)) {
          throw new VisionError(
            "VISION_CORS",
            "浏览器 CORS 拦截了视觉模型 endpoint，请改在桌面或 Pad 打标",
          );
        }
        throw new VisionError("VISION_HTTP", message);
      }
      const rawText = await response.text();
      const safe = redact(rawText, request.apiKey);
      if (!response.ok) {
        throw new VisionError(
          "VISION_HTTP",
          `视觉模型 HTTP ${response.status}: ${safe.slice(0, 180)}`,
        );
      }
      let payload: unknown;
      try {
        payload = JSON.parse(rawText);
      } catch {
        return safe;
      }
      const content = (payload as { choices?: { message?: { content?: unknown } }[] })
        .choices?.[0]?.message?.content;
      if (typeof content === "string") {
        return content;
      }
      if (content && typeof content === "object") {
        return JSON.stringify(content);
      }
      throw new VisionError("VISION_PARSE", "模型响应没有 message.content");
    },
  };
}

export type VisionJpegEncoder = (input: {
  bytes: Uint8Array;
  mimeType: string;
  maxEdgePx: number;
  jpegQuality: number;
}) => Promise<Uint8Array | null>;

/** Pass-through for already-small JPEG; otherwise skip (callers inject canvas/Rust). */
export const passThroughJpegEncoder: VisionJpegEncoder = async ({ bytes, mimeType }) => {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg" || (bytes[0] === 0xff && bytes[1] === 0xd8)) {
    return bytes;
  }
  return null;
};

export type TagAssetVisionInput = {
  provider: VisionProviderConfig;
  settings: VisionTagSettings;
  jpegBytes?: Uint8Array;
  originalBytes?: Uint8Array;
  network?: NetworkKind;
  client?: VisionChatClient;
  encoder?: VisionJpegEncoder;
  lowRes?: boolean;
};

async function loadJpegBytes(
  remote: RemoteLockTarget,
  item: AssetItem,
  input: TagAssetVisionInput,
): Promise<Uint8Array> {
  if (input.jpegBytes) {
    return input.jpegBytes;
  }
  const bytes = input.originalBytes
    ?? (await remote.store.get(blobKey(remote.prefix ?? "", item.blobSha256)))?.body;
  if (!bytes) {
    throw new VisionError("VISION_NOT_RASTER", "没有可送模的图像字节");
  }
  const encoder = input.encoder ?? passThroughJpegEncoder;
  const jpeg = await encoder({
    bytes,
    mimeType: item.mimeType,
    maxEdgePx: input.settings.sendImage.maxEdgePx,
    jpegQuality: input.settings.sendImage.jpegQuality,
  });
  if (!jpeg) {
    throw new VisionError("VISION_NOT_RASTER", "无法把该文件栅格化为 JPEG");
  }
  return jpeg;
}

export async function tagAssetWithVision(
  remote: RemoteLockTarget,
  assetId: string,
  input: TagAssetVisionInput,
  options?: VisionWriteOptions,
): Promise<AssetItem> {
  if (!input.provider.apiKey) {
    throw new VisionError("VISION_NO_KEY", "未配置视觉模型 API Key");
  }
  if (!input.settings.enabled) {
    throw new VisionError("VISION_DISABLED", "视觉打标签未启用");
  }
  const network = input.network ?? "wifi";
  if (!allowVisionUpload(input.settings.sendImage.wifiOnly, network)) {
    throw new VisionError("VISION_WIFI_ONLY", "蜂窝网络下不送图到视觉模型");
  }
  const prefix = remote.prefix ?? "";
  const metaGot = await remote.store.get(assetItemMetaKey(prefix, assetId));
  if (!metaGot) {
    throw new Error(`Asset not found: ${assetId}`);
  }
  const item = decodeJson(metaGot.body) as AssetItem;
  if (!isRasterAsset(item) && !input.jpegBytes) {
    throw new VisionError("VISION_NOT_RASTER", "非静态图，跳过打标");
  }
  const jpeg = await loadJpegBytes(remote, item, input);
  const prompt = effectiveVisionPrompt(input.settings);
  const client = input.client ?? createOpenAiVisionClient();
  const text = await client.complete({
    endpoint: input.provider.endpoint,
    apiKey: input.provider.apiKey,
    model: input.provider.model,
    systemPrompt: prompt,
    imageJpegBase64: bytesToBase64(jpeg),
  });
  const groups = parseVisionTagJson(text);
  const promptHash = await hashVisionPrompt(prompt);
  const clock = options?.clock ?? createHlcClock(remote.deviceId);
  const nowMs = options?.nowMs ?? Date.now();
  const taggedAt = new Date(nowMs).toISOString();
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const latest = await remote.store.get(assetItemMetaKey(prefix, assetId));
      if (!latest) {
        throw new Error(`Asset not found: ${assetId}`);
      }
      const current = decodeJson(latest.body) as AssetItem;
      const next = applyVisionGroups(current, groups, {
        model: input.provider.model,
        taggedAt,
        promptHash,
        clock,
        nowMs,
      });
      await remote.store.put(assetItemMetaKey(prefix, assetId), encodeJson(next), {
        contentType: "application/json",
        ifMatch: latest.etag,
      });
      const held = await remote.store.get(lockKey(prefix));
      if (!held) {
        throw new Error("vision tag PUT requires an active lock.json");
      }
      return next;
    },
    lockOpts(options),
  );
}

export type VisionTagJob = {
  assetId: string;
  jpegBytes?: Uint8Array;
  originalBytes?: Uint8Array;
  lowRes?: boolean;
};

export type VisionTagQueue = {
  pending: VisionTagJob[];
  active: VisionTagJob | null;
  done: number;
  failed: { assetId: string; code: string; message: string }[];
};

export function createVisionTagQueue(): VisionTagQueue {
  return { pending: [], active: null, done: 0, failed: [] };
}

export function enqueueVisionTagJob(queue: VisionTagQueue, job: VisionTagJob): VisionTagQueue {
  if (queue.pending.some((item) => item.assetId === job.assetId) || queue.active?.assetId === job.assetId) {
    return queue;
  }
  queue.pending.push(job);
  return queue;
}

export function visionTagProgress(queue: VisionTagQueue): { current: number; total: number } {
  const total = queue.done + queue.failed.length + queue.pending.length + (queue.active ? 1 : 0);
  return { current: queue.done, total };
}

export async function drainVisionTagQueue(
  queue: VisionTagQueue,
  run: (job: VisionTagJob) => Promise<unknown>,
): Promise<VisionTagQueue> {
  while (queue.pending.length > 0) {
    const job = queue.pending.shift();
    if (!job) {
      break;
    }
    queue.active = job;
    try {
      await run(job);
      queue.done += 1;
    } catch (error) {
      const code = isVisionError(error) ? error.code : "VISION_HTTP";
      const message = error instanceof Error ? error.message : String(error);
      queue.failed.push({ assetId: job.assetId, code, message });
    } finally {
      queue.active = null;
    }
  }
  return queue;
}
