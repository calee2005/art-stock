import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CORS_ALLOWED_HEADERS,
  CORS_ERROR_MESSAGE,
  CORS_LOCK_HEADERS,
  checkBucketCors,
  corsExampleJson,
  describeCorsFailure,
  isCorsFailure,
  ossCorsDocument,
} from "./cors.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("CORS JSON includes lock-condition headers and no secrets", () => {
  const json = corsExampleJson(["https://calee2005.github.io"]);
  for (const header of CORS_LOCK_HEADERS) {
    assert.ok(json.includes(header), `missing ${header}`);
  }
  assert.ok(json.includes("Authorization"));
  assert.ok(json.includes("x-amz-content-sha256"));
  assert.ok(json.includes("ETag"));
  assert.ok(json.includes("PUT"));
  assert.doesNotMatch(json, /secretAccessKey|AWS_SECRET|LTAI[0-9A-Za-z]/);
  const doc = ossCorsDocument(["https://example.github.io"]);
  assert.deepEqual([...CORS_ALLOWED_HEADERS], doc.CORSRules[0]?.AllowedHeaders);
});

test("Failed to fetch is a readable CORS error, not a blank page payload", () => {
  const failed = new TypeError("Failed to fetch");
  assert.equal(isCorsFailure(failed), true);
  assert.equal(describeCorsFailure(failed), CORS_ERROR_MESSAGE);
  assert.match(CORS_ERROR_MESSAGE, /不是白屏|不会白屏|可继续/);
  assert.equal(isCorsFailure(new Error("REMOTE_UNSUPPORTED")), false);
});

test("checkBucketCors maps fetch TypeError to cors:true without sending keys", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const result = await checkBucketCors({
    endpoint: "https://oss.example",
    bucket: "art",
    forcePathStyle: true,
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init });
      throw new TypeError("Failed to fetch");
    }) as typeof fetch,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.cors, true);
    assert.equal(result.message, CORS_ERROR_MESSAGE);
    assert.match(result.url ?? "", /\/art\/\.artstock\/v1\/manifest\.json$/);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.method, "HEAD");
  assert.equal(calls[0]?.init?.mode, "cors");
  const headers = calls[0]?.init?.headers;
  const blob = headers ? JSON.stringify(headers) : "";
  assert.doesNotMatch(blob, /secretAccessKey|Authorization/i);
});

test("Pages workflow builds web without injecting secrets", () => {
  const workflow = readFileSync(
    resolve(root, ".github/workflows/pages.yml"),
    "utf8",
  );
  assert.match(workflow, /pnpm --filter @art-stock\/web build/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /secretAccessKey|AWS_SECRET_ACCESS_KEY|OSS_ACCESS_KEY/);
  const example = readFileSync(resolve(root, "docs/cors-oss.example.json"), "utf8");
  for (const header of CORS_LOCK_HEADERS) {
    assert.ok(example.includes(header), `docs example missing ${header}`);
  }
  assert.doesNotMatch(example, /secretAccessKey/);
});
