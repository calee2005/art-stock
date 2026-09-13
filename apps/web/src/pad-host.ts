import {
  MemoryObjectStore,
  commitSnapshot,
  createLibrary,
  DEFAULT_SNAPSHOT_POLICY,
  importAsset,
  importObjectNow,
  inferObjectType,
  listLibraries,
  type ObjectStore,
  type RemoteLockTarget,
  type SnapshotPolicy,
} from "@art-stock/core";
import { S3ObjectStore } from "@art-stock/s3";
import {
  emptyRemoteForm,
  formToConfig,
  hasCredentials,
  loadRemoteForm,
  putWithGlobalLock,
  savePublicRemoteForm,
  saveRemoteForm,
  type RemoteForm,
  type StorageLike,
} from "./session.ts";

export { stripSecretsFromForm } from "./session.ts";

export const OSS_ACCESS_KEY = "accessKeyId";
export const OSS_SECRET_KEY = "secretAccessKey";

export type TauriInvoke = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

type TauriWindow = {
  __TAURI__?: { core?: { invoke?: TauriInvoke } };
  __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
};

export function isTauriHost(
  win: TauriWindow | undefined = globalThis.window as TauriWindow | undefined,
): boolean {
  if (!win) {
    return false;
  }
  return Boolean(win.__TAURI__?.core?.invoke || win.__TAURI_INTERNALS__?.invoke);
}

export function isAndroidUserAgent(ua: string): boolean {
  return /Android/i.test(ua);
}

export function isAndroidPad(
  ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
  win?: TauriWindow,
): boolean {
  return isAndroidUserAgent(ua) || (isTauriHost(win) && isAndroidUserAgent(ua));
}

export function tauriInvokeFn(
  win: TauriWindow | undefined = globalThis.window as TauriWindow | undefined,
): TauriInvoke | null {
  if (!win) {
    return null;
  }
  if (win.__TAURI__?.core?.invoke) {
    return win.__TAURI__.core.invoke.bind(win.__TAURI__.core);
  }
  if (win.__TAURI_INTERNALS__?.invoke) {
    return win.__TAURI_INTERNALS__.invoke;
  }
  return null;
}

export async function waitForTauriInvoke(timeoutMs = 12_000): Promise<TauriInvoke | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const invoke = tauriInvokeFn();
    if (invoke) {
      return invoke;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return tauriInvokeFn();
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out;
}

const demoStore = new MemoryObjectStore();

export function activeStore(form: RemoteForm): ObjectStore {
  if (!hasCredentials(form)) {
    return demoStore;
  }
  return new S3ObjectStore(formToConfig(form));
}

export async function persistRemoteForm(
  storage: StorageLike,
  form: RemoteForm,
  invoke: TauriInvoke | null = tauriInvokeFn(),
): Promise<void> {
  if (invoke) {
    savePublicRemoteForm(storage, form);
    if (form.accessKeyId) {
      await invoke("secure_store_set", { key: OSS_ACCESS_KEY, value: form.accessKeyId });
    }
    if (form.secretAccessKey) {
      await invoke("secure_store_set", { key: OSS_SECRET_KEY, value: form.secretAccessKey });
    }
    return;
  }
  saveRemoteForm(storage, form);
}

export async function restoreRemoteForm(
  storage: StorageLike,
  invoke: TauriInvoke | null = tauriInvokeFn(),
): Promise<RemoteForm> {
  const loaded = loadRemoteForm(storage) ?? emptyRemoteForm();
  if (!invoke) {
    return loaded;
  }
  const access = (await invoke("secure_store_get", { key: OSS_ACCESS_KEY })) as string | null;
  const secret = (await invoke("secure_store_get", { key: OSS_SECRET_KEY })) as string | null;
  return {
    ...loaded,
    accessKeyId: access ?? loaded.accessKeyId,
    secretAccessKey: secret ?? loaded.secretAccessKey,
  };
}

export function localStorageHasSecret(storage: StorageLike, secret: string): boolean {
  if (!secret) {
    return false;
  }
  const keys = ["art-stock.device", "art-stock.remote-config", "art-stock.pins", "art-stock.vision-provider"];
  for (const key of keys) {
    const raw = storage.getItem(key);
    if (raw?.includes(secret)) {
      return true;
    }
  }
  return false;
}

export type PadE2ePublicConfig = {
  endpoint: string;
  bucket: string;
  prefix?: string;
  forcePathStyle?: boolean;
  libraryName?: string;
  uploadName?: string;
};

export function assertPublicE2eConfig(raw: string): PadE2ePublicConfig {
  const lower = raw.toLowerCase();
  if (lower.includes("secretaccesskey") || lower.includes("super-secret")) {
    throw new Error("pad-e2e.json must not contain secrets");
  }
  const parsed = JSON.parse(raw) as PadE2ePublicConfig;
  if (!parsed.endpoint?.trim() || !parsed.bucket?.trim()) {
    throw new Error("pad-e2e.json needs endpoint and bucket");
  }
  return parsed;
}

export function applyPadE2eConfig(form: RemoteForm, e2e: PadE2ePublicConfig): RemoteForm {
  return {
    ...form,
    name: form.name || "pad-oss",
    endpoint: e2e.endpoint,
    bucket: e2e.bucket,
    prefix: e2e.prefix ?? form.prefix,
    forcePathStyle: e2e.forcePathStyle ?? true,
    mode: "readwrite",
  };
}

export async function loadPadE2eConfig(
  invoke: TauriInvoke | null = tauriInvokeFn(),
): Promise<PadE2ePublicConfig | null> {
  if (!invoke) {
    return null;
  }
  const value = (await invoke("pad_e2e_config")) as PadE2ePublicConfig | null;
  if (!value) {
    return null;
  }
  return assertPublicE2eConfig(JSON.stringify(value));
}

export async function reportPadE2e(
  status: Record<string, unknown>,
  invoke: TauriInvoke | null = tauriInvokeFn(),
): Promise<void> {
  if (!invoke) {
    return;
  }
  const json = JSON.stringify(status);
  if (json.toLowerCase().includes("secretaccesskey") || json.includes("super-secret")) {
    throw new Error("pad-e2e-status must not contain secrets");
  }
  await invoke("pad_e2e_report", { status });
}

export async function runPadBrowseAndUpload(input: {
  store: ObjectStore;
  form: RemoteForm;
  deviceId: string;
  deviceName: string;
  libraryName: string;
  uploadBody: string;
  uploadName?: string;
}): Promise<{
  libraryNames: string[];
  lockSeenDuringPut: boolean;
  fencingToken: number;
  putKey: string;
}> {
  const config = formToConfig(input.form);
  const created = await createLibrary(
    {
      store: input.store,
      prefix: config.prefix,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
    },
    input.libraryName,
  );
  const listed = await listLibraries(input.store, config.prefix);
  const put = await putWithGlobalLock(
    input.store,
    config,
    { deviceId: input.deviceId, deviceName: input.deviceName },
    input.uploadName ?? "pad-upload.txt",
    input.uploadBody,
  );
  return {
    libraryNames: listed.map((item) => item.name),
    lockSeenDuringPut: put.lockSeenDuringPut,
    fencingToken: put.fencingToken,
    putKey: put.putKey,
  };
}

export type InboxItem = {
  name: string;
  size: number;
  mimeGuess?: string;
};

export const INBOX_SCAN_STORAGE_KEY = "art-stock.inbox-scan";

export type InboxScanState = {
  libraryId?: string;
  seen: Record<string, number>;
  objectIds: Record<string, string>;
  lastCommitAt: Record<string, number>;
};

export function emptyInboxScanState(): InboxScanState {
  return { seen: {}, objectIds: {}, lastCommitAt: {} };
}

export function loadInboxScanState(storage: StorageLike): InboxScanState {
  try {
    const raw = storage.getItem(INBOX_SCAN_STORAGE_KEY);
    if (!raw) {
      return emptyInboxScanState();
    }
    const parsed = JSON.parse(raw) as Partial<InboxScanState>;
    return {
      libraryId: typeof parsed.libraryId === "string" ? parsed.libraryId : undefined,
      seen: parsed.seen ?? {},
      objectIds: parsed.objectIds ?? {},
      lastCommitAt: parsed.lastCommitAt ?? {},
    };
  } catch {
    return emptyInboxScanState();
  }
}

export function saveInboxScanState(storage: StorageLike, state: InboxScanState): void {
  storage.setItem(INBOX_SCAN_STORAGE_KEY, JSON.stringify(state));
}

function normalizeInboxScanState(parsed: Partial<InboxScanState> | null | undefined): InboxScanState {
  if (!parsed) {
    return emptyInboxScanState();
  }
  return {
    libraryId: typeof parsed.libraryId === "string" ? parsed.libraryId : undefined,
    seen: parsed.seen ?? {},
    objectIds: parsed.objectIds ?? {},
    lastCommitAt: parsed.lastCommitAt ?? {},
  };
}

export async function loadInboxScanStateHost(
  storage: StorageLike,
  invoke: TauriInvoke | null,
): Promise<InboxScanState> {
  if (invoke) {
    try {
      const value = (await invoke("inbox_scan_load")) as Partial<InboxScanState> | null;
      if (value && (value.objectIds || value.seen || value.libraryId)) {
        return normalizeInboxScanState(value);
      }
    } catch {
      // fall back to localStorage
    }
  }
  return loadInboxScanState(storage);
}

export async function saveInboxScanStateHost(
  storage: StorageLike,
  invoke: TauriInvoke | null,
  state: InboxScanState,
): Promise<void> {
  saveInboxScanState(storage, state);
  if (!invoke) {
    return;
  }
  const json = JSON.stringify(state);
  if (json.toLowerCase().includes("secretaccesskey") || json.includes("super-secret")) {
    throw new Error("inbox scan state must not contain secrets");
  }
  await invoke("inbox_scan_save", { state });
}

export function diffInbox(previous: InboxItem[], next: InboxItem[]): InboxItem[] {
  const seen = new Set(previous.map((item) => `${item.name}:${item.size}`));
  return next.filter((item) => !seen.has(`${item.name}:${item.size}`));
}

export async function applyInboxScan(input: {
  previous: InboxScanState;
  items: InboxItem[];
  read: (name: string) => Promise<Uint8Array>;
  remote: RemoteLockTarget;
  libraryId: string;
  policy?: SnapshotPolicy;
  now?: () => number;
}): Promise<{
  state: InboxScanState;
  imported: string[];
  snapshotted: string[];
  skippedManual: string[];
}> {
  const policy = input.policy ?? DEFAULT_SNAPSHOT_POLICY;
  const now = input.now ?? Date.now;
  const state: InboxScanState = {
    libraryId: input.libraryId,
    seen: { ...input.previous.seen },
    objectIds: { ...input.previous.objectIds },
    lastCommitAt: { ...(input.previous.lastCommitAt ?? {}) },
  };
  const imported: string[] = [];
  const snapshotted: string[] = [];
  const skippedManual: string[] = [];
  for (const item of input.items) {
    const prevSize = state.seen[item.name];
    if (prevSize === item.size) {
      continue;
    }
    const bytes = await input.read(item.name);
    const objectId = state.objectIds[item.name];
    const ts = now();
    if (!objectId) {
      const created = await importObjectNow(input.remote, {
        libraryId: input.libraryId,
        parentFolderId: null,
        name: item.name,
        bytes,
        type: inferObjectType(item.name, item.mimeGuess),
        mimeType: item.mimeGuess ?? "application/octet-stream",
      });
      state.objectIds[item.name] = created.object.id;
      state.seen[item.name] = item.size;
      state.lastCommitAt[item.name] = ts;
      imported.push(item.name);
      continue;
    }
    if (policy.mode === "manual") {
      skippedManual.push(item.name);
      continue;
    }
    const last = state.lastCommitAt[item.name] ?? 0;
    if (ts - last < policy.minIntervalMs) {
      continue;
    }
    await commitSnapshot(input.remote, objectId, bytes, `inbox scan ${item.name}`);
    state.seen[item.name] = item.size;
    state.lastCommitAt[item.name] = ts;
    snapshotted.push(item.name);
  }
  return { state, imported, snapshotted, skippedManual };
}

export async function scanPadInboxNow(input: {
  invoke: TauriInvoke;
  previous: InboxScanState;
  remote: RemoteLockTarget;
  libraryId: string;
  policy?: SnapshotPolicy;
  now?: () => number;
}): Promise<{
  items: InboxItem[];
  result: Awaited<ReturnType<typeof applyInboxScan>>;
}> {
  const items = await listPadInbox(input.invoke);
  const result = await applyInboxScan({
    previous: input.previous,
    items,
    read: async (name) => bytesFromInvoke(await input.invoke("inbox_read", { name })),
    remote: input.remote,
    libraryId: input.libraryId,
    policy: input.policy,
    now: input.now,
  });
  return { items, result };
}

export function bytesFromInvoke(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Uint8Array.from(raw as number[]);
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return Uint8Array.from((raw as { data: number[] }).data);
  }
  throw new Error("inbox_read did not return bytes");
}

export async function listPadInbox(invoke: TauriInvoke): Promise<InboxItem[]> {
  const listed = (await invoke("inbox_list")) as InboxItem[] | null;
  return listed ?? [];
}

export async function importInboxToAssets(input: {
  invoke: TauriInvoke;
  remote: RemoteLockTarget;
  name: string;
  mimeType?: string;
}): Promise<{ assetId: string; name: string }> {
  const raw = await input.invoke("inbox_read", { name: input.name });
  const bytes = bytesFromInvoke(raw);
  const item = await importAsset(input.remote, {
    name: input.name,
    bytes,
    mimeType: input.mimeType ?? "image/png",
  });
  await input.invoke("inbox_remove", { name: input.name });
  return { assetId: item.id, name: input.name };
}

export async function loadPadShareE2eConfig(
  invoke: TauriInvoke | null = tauriInvokeFn(),
): Promise<{ importTo?: string } | null> {
  if (!invoke) {
    return null;
  }
  const value = (await invoke("pad_share_e2e_config")) as { importTo?: string } | null;
  if (!value) {
    return null;
  }
  const json = JSON.stringify(value);
  if (json.toLowerCase().includes("secretaccesskey") || json.includes("super-secret")) {
    throw new Error("pad-share-e2e.json must not contain secrets");
  }
  return value;
}

export async function reportPadShareE2e(
  status: Record<string, unknown>,
  invoke: TauriInvoke | null = tauriInvokeFn(),
): Promise<void> {
  if (!invoke) {
    return;
  }
  const json = JSON.stringify(status);
  if (json.toLowerCase().includes("secretaccesskey") || json.includes("super-secret")) {
    throw new Error("pad-share-e2e-status must not contain secrets");
  }
  await invoke("pad_share_e2e_report", { status });
}

export type PadScanE2eConfig = {
  libraryId?: string;
  libraryName?: string;
  snapshotPolicy?: SnapshotPolicy;
};

export async function loadPadScanE2eConfig(
  invoke: TauriInvoke | null = tauriInvokeFn(),
): Promise<PadScanE2eConfig | null> {
  if (!invoke) {
    return null;
  }
  const value = (await invoke("pad_scan_e2e_config")) as PadScanE2eConfig | null;
  if (!value) {
    return null;
  }
  const json = JSON.stringify(value);
  if (json.toLowerCase().includes("secretaccesskey") || json.includes("super-secret")) {
    throw new Error("pad-scan-e2e.json must not contain secrets");
  }
  return value;
}

export async function reportPadScanE2e(
  status: Record<string, unknown>,
  invoke: TauriInvoke | null = tauriInvokeFn(),
): Promise<void> {
  if (!invoke) {
    return;
  }
  const json = JSON.stringify(status);
  if (json.toLowerCase().includes("secretaccesskey") || json.includes("super-secret")) {
    throw new Error("pad-scan-e2e-status must not contain secrets");
  }
  await invoke("pad_scan_e2e_report", { status });
}

export async function loadPadSafE2eConfig(
  invoke: TauriInvoke | null = tauriInvokeFn(),
): Promise<Record<string, unknown> | null> {
  if (!invoke) {
    return null;
  }
  const value = (await invoke("pad_saf_e2e_config")) as Record<string, unknown> | null;
  if (!value) {
    return null;
  }
  const json = JSON.stringify(value);
  if (json.toLowerCase().includes("secretaccesskey") || json.includes("super-secret")) {
    throw new Error("pad-saf-e2e.json must not contain secrets");
  }
  return value;
}

export async function reportPadSafE2e(
  status: Record<string, unknown>,
  invoke: TauriInvoke | null = tauriInvokeFn(),
): Promise<void> {
  if (!invoke) {
    return;
  }
  const json = JSON.stringify(status);
  if (json.toLowerCase().includes("secretaccesskey") || json.includes("super-secret")) {
    throw new Error("pad-saf-e2e-status must not contain secrets");
  }
  await invoke("pad_saf_e2e_report", { status });
}

export { demoStore };
