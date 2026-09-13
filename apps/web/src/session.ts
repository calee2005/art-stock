import {
  defaultRemoteConfig,
  lockKey,
  manifestKey,
  normalizePrefix,
  probeConditionalWrites,
  protocolRoot,
  RemoteError,
  withRemoteLock,
  type ObjectStore,
  type RemoteConfig,
  type RemoteMode,
} from "@art-stock/core";

export const REMOTE_STORAGE_KEY = "art-stock.remote-config";
export const DEVICE_STORAGE_KEY = "art-stock.device";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type RemoteForm = {
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  mode: RemoteMode;
};

export type ProbeResult =
  | { ok: true; protocolRoot: string }
  | { ok: false; code: "REMOTE_UNSUPPORTED" | "EMPTY_CREDENTIALS"; message: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function emptyRemoteForm(): RemoteForm {
  return {
    name: "",
    endpoint: "",
    region: "",
    bucket: "",
    prefix: "",
    accessKeyId: "",
    secretAccessKey: "",
    forcePathStyle: true,
    mode: "readwrite",
  };
}

export function formToConfig(form: RemoteForm, id = "web-remote"): RemoteConfig {
  return defaultRemoteConfig({
    id,
    name: form.name || form.bucket || "remote",
    endpoint: form.endpoint.trim(),
    region: form.region.trim() || undefined,
    bucket: form.bucket.trim(),
    prefix: form.prefix,
    accessKeyId: form.accessKeyId,
    secretAccessKey: form.secretAccessKey,
    forcePathStyle: form.forcePathStyle,
    mode: form.mode,
  });
}

export function hasCredentials(form: Pick<RemoteForm, "accessKeyId" | "secretAccessKey" | "endpoint" | "bucket">): boolean {
  return (
    form.endpoint.trim().length > 0 &&
    form.bucket.trim().length > 0 &&
    form.accessKeyId.length > 0 &&
    form.secretAccessKey.length > 0
  );
}

export function saveRemoteForm(storage: StorageLike, form: RemoteForm): void {
  storage.setItem(REMOTE_STORAGE_KEY, JSON.stringify(form));
}

export function loadRemoteForm(storage: StorageLike): RemoteForm | null {
  const raw = storage.getItem(REMOTE_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RemoteForm>;
    return { ...emptyRemoteForm(), ...parsed };
  } catch {
    return null;
  }
}

export function deviceIdentity(storage: StorageLike): { deviceId: string; deviceName: string } {
  const raw = storage.getItem(DEVICE_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { deviceId?: string; deviceName?: string };
      if (parsed.deviceId) {
        return {
          deviceId: parsed.deviceId,
          deviceName: parsed.deviceName ?? "web",
        };
      }
    } catch {
      /* recreate */
    }
  }
  const deviceId = crypto.randomUUID();
  const identity = { deviceId, deviceName: "web" };
  storage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export async function probeReadwrite(
  store: ObjectStore,
  prefix: string,
): Promise<ProbeResult> {
  try {
    await probeConditionalWrites(store, prefix);
    return { ok: true, protocolRoot: protocolRoot(prefix) };
  } catch (error) {
    if (error instanceof RemoteError && error.code === "REMOTE_UNSUPPORTED") {
      return {
        ok: false,
        code: "REMOTE_UNSUPPORTED",
        message: "远端不支持条件写，不能作为读写远端",
      };
    }
    throw error;
  }
}

export function assertCanWrite(mode: RemoteMode): void {
  if (mode === "readonly") {
    throw new Error("只读远端禁用写入");
  }
}

export async function listProtocolKeys(
  store: ObjectStore,
  prefix: string,
): Promise<string[]> {
  const listed = await store.list(protocolRoot(normalizePrefix(prefix)));
  return listed.keys.map((item) => item.key);
}

export async function getManifest(
  store: ObjectStore,
  prefix: string,
): Promise<{ json: unknown; etag: string } | null> {
  const got = await store.get(manifestKey(prefix));
  if (!got) {
    return null;
  }
  return { json: JSON.parse(decoder.decode(got.body)), etag: got.etag };
}

export type ControlledPutResult = {
  fencingToken: number;
  lockSeenDuringPut: boolean;
  putKey: string;
};

export async function putWithGlobalLock(
  store: ObjectStore,
  config: RemoteConfig,
  device: { deviceId: string; deviceName: string },
  relativeKey: string,
  body: string,
): Promise<ControlledPutResult> {
  assertCanWrite(config.mode);
  const prefix = config.prefix;
  return withRemoteLock(
    {
      store,
      prefix,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
    },
    "upload",
    async (ctx) => {
      const lock = await store.get(lockKey(prefix));
      const putKey = `${protocolRoot(prefix)}${relativeKey.replace(/^\/+/, "")}`;
      await store.put(putKey, encoder.encode(body), {
        contentType: "text/plain",
      });
      return {
        fencingToken: ctx.fencingToken,
        lockSeenDuringPut: lock != null,
        putKey,
      };
    },
    { probe: false, scheduleHeartbeat: () => () => {} },
  );
}
