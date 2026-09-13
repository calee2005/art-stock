import {
  DEFAULT_SNAPSHOT_POLICY,
  createAutoSnapshotController,
  createLibrary,
  listLibraries,
  type AutoSnapshotResult,
  type ObjectStore,
  type RemoteConfig,
  type RemoteLockTarget,
  type SnapshotPolicy,
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

export type WatchedArtwork = {
  path: string;
  objectId: string;
  policy?: SnapshotPolicy;
};

export type DesktopFileIo = {
  readFile(path: string): Promise<Uint8Array>;
};

/**
 * Bind local files to artwork objects. Native watch_start/stop only reports
 * path changes; this host reads bytes and debounces commitSnapshot.
 */
export function createDesktopFileWatch(
  remote: RemoteLockTarget,
  io: DesktopFileIo,
  controller = createAutoSnapshotController(),
) {
  const bindings = new Map<string, WatchedArtwork>();
  return {
    bind(watch: WatchedArtwork): void {
      bindings.set(watch.path, watch);
    },
    unbind(path: string): void {
      const current = bindings.get(path);
      if (current) {
        controller.cancel(current.objectId);
      }
      bindings.delete(path);
    },
    async onFsChange(path: string): Promise<AutoSnapshotResult | { status: "unbound" }> {
      const watch = bindings.get(path);
      if (!watch) {
        return { status: "unbound" };
      }
      const bytes = await io.readFile(path);
      return controller.notifyFileSaved(
        remote,
        watch.objectId,
        bytes,
        watch.policy ?? DEFAULT_SNAPSHOT_POLICY,
      );
    },
  };
}
