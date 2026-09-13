import {
  MemoryObjectStore,
  createLibrary,
  listLibraries,
  type ObjectStore,
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
  const keys = ["art-stock.device", "art-stock.remote-config", "art-stock.pins"];
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

export { demoStore };
