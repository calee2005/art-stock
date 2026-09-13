import { artstockAssetUrl, commitSnapshot, readBranchBytes } from "@art-stock/core";
import type { RemoteLockTarget } from "@art-stock/core";

export type PluginFileType = {
  typeId: string;
  extensions: string[];
  mime?: string;
};

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  fileTypes: PluginFileType[];
  entry: string;
  enabled?: boolean;
  loadError?: string;
};

export type PluginHostApi = {
  registerEditor: (
    typeId: string,
    open: (objectId: string) => Promise<{ byteLength: number }>,
  ) => void;
  readBlob: (objectId: string) => Promise<Uint8Array>;
  writeBlob: (objectId: string, bytes: Uint8Array) => Promise<void>;
  getAssetUrl: (assetId: string) => string;
};

const PLUGIN_API_KEYS = [
  "registerEditor",
  "readBlob",
  "writeBlob",
  "getAssetUrl",
] as const;

export function assertPluginApiHasNoSecrets(api: PluginHostApi): void {
  const keys = Object.keys(api);
  if (keys.some((key) => /secret|accessKey|password|token/i.test(key))) {
    throw new Error("Plugin API must not expose secrets");
  }
  for (const key of PLUGIN_API_KEYS) {
    if (!(key in api)) {
      throw new Error(`Plugin API missing ${key}`);
    }
  }
}

export function parsePluginManifest(json: string): PluginManifest {
  const raw = JSON.parse(json) as PluginManifest;
  if (!raw?.id || raw.apiVersion !== 1 || !Array.isArray(raw.fileTypes)) {
    throw new Error("Invalid plugin manifest");
  }
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    apiVersion: 1,
    fileTypes: raw.fileTypes,
    entry: raw.entry,
    enabled: raw.enabled !== false,
  };
}

export function createPluginHost(input: {
  remote: RemoteLockTarget;
  allowThirdParty?: boolean;
}) {
  const editors = new Map<
    string,
    (objectId: string) => Promise<{ byteLength: number }>
  >();
  const manifests: PluginManifest[] = [];
  const allowThirdParty = input.allowThirdParty !== false;

  const api: PluginHostApi = {
    registerEditor(typeId, open) {
      editors.set(typeId, open);
    },
    async readBlob(objectId) {
      const got = await readBranchBytes(
        input.remote.store,
        input.remote.prefix ?? "",
        objectId,
      );
      if (!got) {
        throw new Error("CACHE_MISS");
      }
      return got.bytes;
    },
    async writeBlob(objectId, bytes) {
      await commitSnapshot(input.remote, objectId, bytes, "plugin-write");
    },
    getAssetUrl(assetId) {
      return artstockAssetUrl(assetId);
    },
  };
  assertPluginApiHasNoSecrets(api);
  Object.freeze(api);

  return {
    api,
    manifests,
    loadManifest(json: string, thirdParty = true) {
      if (thirdParty && !allowThirdParty) {
        return;
      }
      const manifest = parsePluginManifest(json);
      manifests.push(manifest);
      if (!manifest.enabled) {
        return;
      }
      for (const fileType of manifest.fileTypes) {
        api.registerEditor(fileType.typeId, async (objectId) => {
          const bytes = await api.readBlob(objectId);
          return { byteLength: bytes.byteLength };
        });
      }
    },
    registeredTypes() {
      return [...editors.keys()];
    },
    async open(typeId: string, objectId: string) {
      const open = editors.get(typeId);
      if (!open) {
        throw new Error(`No plugin editor for ${typeId}`);
      }
      return open(objectId);
    },
    inferType(name: string): string | null {
      const lower = name.toLowerCase();
      for (const manifest of manifests) {
        if (manifest.enabled === false) {
          continue;
        }
        for (const fileType of manifest.fileTypes) {
          if (
            fileType.extensions.some((ext) =>
              lower.endsWith(ext.toLowerCase()),
            )
          ) {
            return fileType.typeId;
          }
        }
      }
      return null;
    },
  };
}

export const EXAMPLE_PUB_MANIFEST: PluginManifest = {
  id: "com.example.pub",
  name: "虚拟出版物",
  version: "0.1.0",
  apiVersion: 1,
  fileTypes: [
    {
      typeId: "publication",
      extensions: [".vpub"],
      mime: "application/x-vpub",
    },
  ],
  entry: "index.js",
  enabled: true,
};

export function examplePubManifestJson(): string {
  return JSON.stringify(EXAMPLE_PUB_MANIFEST);
}
