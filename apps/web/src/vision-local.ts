import {
  createOpenAiVisionClient,
  defaultVisionProvider,
  type VisionChatClient,
  type VisionProviderConfig,
} from "@art-stock/core";
import type { StorageLike } from "./session.ts";
import type { TauriInvoke } from "./pad-host.ts";

export const VISION_PROVIDER_STORAGE_KEY = "art-stock.vision-provider";
export const VISION_PRIVACY_STORAGE_KEY = "art-stock.vision-privacy";
export const VISION_MOCK_STORAGE_KEY = "art-stock.vision-mock";
export const VISION_API_KEY_STORE = "visionApiKey";

export function emptyVisionProvider(): VisionProviderConfig {
  return defaultVisionProvider({ apiKey: "" });
}

export function publicVisionProvider(provider: VisionProviderConfig): VisionProviderConfig {
  return { ...provider, apiKey: "" };
}

export function last4Secret(secret: string): string {
  if (!secret) {
    return "未填写";
  }
  return secret.slice(-4);
}

export function loadVisionProvider(storage: StorageLike): VisionProviderConfig {
  const raw = storage.getItem(VISION_PROVIDER_STORAGE_KEY);
  if (!raw) {
    return emptyVisionProvider();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<VisionProviderConfig>;
    return defaultVisionProvider(parsed);
  } catch {
    return emptyVisionProvider();
  }
}

export function saveVisionProvider(storage: StorageLike, provider: VisionProviderConfig): void {
  storage.setItem(VISION_PROVIDER_STORAGE_KEY, JSON.stringify(provider));
}

export function savePublicVisionProvider(storage: StorageLike, provider: VisionProviderConfig): void {
  const json = JSON.stringify(publicVisionProvider(provider));
  if (provider.apiKey && json.includes(provider.apiKey)) {
    throw new Error("Refusing to persist vision apiKey in public JSON");
  }
  storage.setItem(VISION_PROVIDER_STORAGE_KEY, json);
}

export async function persistVisionProvider(
  storage: StorageLike,
  provider: VisionProviderConfig,
  invoke: TauriInvoke | null,
): Promise<void> {
  if (invoke) {
    savePublicVisionProvider(storage, provider);
    if (provider.apiKey) {
      await invoke("secure_store_set", { key: VISION_API_KEY_STORE, value: provider.apiKey });
    }
    return;
  }
  saveVisionProvider(storage, provider);
}

export async function restoreVisionProvider(
  storage: StorageLike,
  invoke: TauriInvoke | null,
): Promise<VisionProviderConfig> {
  const loaded = loadVisionProvider(storage);
  if (!invoke) {
    return loaded;
  }
  const apiKey = (await invoke("secure_store_get", { key: VISION_API_KEY_STORE })) as string | null;
  return { ...loaded, apiKey: apiKey ?? loaded.apiKey };
}

export function resolveVisionClient(storage: StorageLike): VisionChatClient {
  const mock = storage.getItem(VISION_MOCK_STORAGE_KEY);
  if (mock) {
    return {
      async complete() {
        return mock;
      },
    };
  }
  return createOpenAiVisionClient();
}

export function privacyAccepted(storage: StorageLike): boolean {
  return storage.getItem(VISION_PRIVACY_STORAGE_KEY) === "1";
}

export function acceptVisionPrivacy(storage: StorageLike): void {
  storage.setItem(VISION_PRIVACY_STORAGE_KEY, "1");
}
