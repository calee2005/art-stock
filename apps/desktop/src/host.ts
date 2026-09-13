import {
  createLibrary,
  listLibraries,
  type ObjectStore,
  type RemoteConfig,
  type RemoteLockTarget,
} from "@art-stock/core";

export type SecureStore = {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
};

export type PublicRemote = Omit<RemoteConfig, "accessKeyId" | "secretAccessKey">;

const SECRET_ACCESS = "secretAccessKey";
const SECRET_KEY_ID = "accessKeyId";

/** Persist remote metadata as JSON; credentials only go through SecureStore (IPC). */
export async function saveDesktopRemote(
  publicPathWrite: (json: string) => Promise<void>,
  secrets: SecureStore,
  config: RemoteConfig,
): Promise<void> {
  const publicConfig: PublicRemote = {
    id: config.id,
    name: config.name,
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    prefix: config.prefix,
    forcePathStyle: config.forcePathStyle,
    mode: config.mode,
  };
  const serialized = JSON.stringify(publicConfig);
  if (serialized.includes(config.secretAccessKey) && config.secretAccessKey.length > 0) {
    throw new Error("Refusing to write secret into JSON");
  }
  await publicPathWrite(serialized);
  await secrets.set(SECRET_KEY_ID, config.accessKeyId);
  await secrets.set(SECRET_ACCESS, config.secretAccessKey);
}

export async function loadDesktopRemote(
  publicJson: string,
  secrets: SecureStore,
): Promise<RemoteConfig> {
  const publicConfig = JSON.parse(publicJson) as PublicRemote;
  return {
    ...publicConfig,
    accessKeyId: (await secrets.get(SECRET_KEY_ID)) ?? "",
    secretAccessKey: (await secrets.get(SECRET_ACCESS)) ?? "",
  };
}

export function desktopLockTarget(
  store: ObjectStore,
  prefix: string,
  deviceId = "desktop",
  deviceName = "desktop",
): RemoteLockTarget {
  return { store, prefix, deviceId, deviceName };
}

/** Desktop lists libraries through the same core as Web. */
export async function listLibrariesOnDesktop(store: ObjectStore, prefix: string) {
  return listLibraries(store, prefix);
}

export async function createLibraryOnDesktop(
  store: ObjectStore,
  prefix: string,
  name: string,
) {
  return createLibrary(desktopLockTarget(store, prefix), name);
}
