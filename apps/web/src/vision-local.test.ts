import assert from "node:assert/strict";
import { test } from "node:test";
import {
  last4Secret,
  loadVisionProvider,
  persistVisionProvider,
  publicVisionProvider,
  resolveVisionClient,
  savePublicVisionProvider,
} from "./vision-local.ts";
import type { StorageLike } from "./session.ts";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

test("public vision provider JSON never includes apiKey", () => {
  const provider = {
    id: "deepseek",
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    model: "DeepSeek-Flash",
    apiKey: "sk-web-secret-key",
    apiStyle: "openai-chat-completions" as const,
  };
  const storage = memoryStorage();
  savePublicVisionProvider(storage, provider);
  const raw = storage.getItem("art-stock.vision-provider");
  assert.ok(raw);
  assert.equal(raw.includes("sk-web-secret-key"), false);
  assert.equal(publicVisionProvider(provider).apiKey, "");
  assert.equal(last4Secret(provider.apiKey), "-key");
});

test("web persist keeps apiKey locally; tauri persist uses keystore only", async () => {
  const storage = memoryStorage();
  const provider = {
    id: "deepseek",
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    model: "DeepSeek-Flash",
    apiKey: "sk-web-secret-key",
    apiStyle: "openai-chat-completions" as const,
  };
  await persistVisionProvider(storage, provider, null);
  assert.equal(loadVisionProvider(storage).apiKey, "sk-web-secret-key");

  const padStorage = memoryStorage();
  const secrets = new Map<string, string>();
  await persistVisionProvider(padStorage, provider, async (cmd, args) => {
    if (cmd === "secure_store_set") {
      secrets.set(String(args?.key), String(args?.value));
    }
    return null;
  });
  assert.equal(padStorage.getItem("art-stock.vision-provider")?.includes("sk-web-secret-key"), false);
  assert.equal(secrets.get("visionApiKey"), "sk-web-secret-key");
});

test("resolveVisionClient uses mock payload without calling fetch", async () => {
  const storage = memoryStorage();
  storage.setItem("art-stock.vision-mock", JSON.stringify({ groups: [] }));
  const client = resolveVisionClient(storage);
  const text = await client.complete({
    endpoint: "https://example.invalid",
    apiKey: "sk-should-not-leak",
    model: "x",
    systemPrompt: "p",
    imageJpegBase64: "aa",
  });
  assert.match(text, /groups/);
});
