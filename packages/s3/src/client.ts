import {
  StoreError,
  type DeleteOptions,
  type HeadResult,
  type ListOptions,
  type ListResult,
  type ObjectBody,
  type ObjectStore,
  type PutOptions,
  type RemoteConfig,
} from "@art-stock/core";
import { signAwsV4 } from "./sign.ts";
import { objectUrl } from "./url.ts";

function stripQuotes(etag: string | null): string | undefined {
  if (!etag) {
    return undefined;
  }
  return etag;
}

function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function mapStatus(status: number, key: string): StoreError | null {
  if (status === 404) {
    return null;
  }
  if (status === 412 || status === 409) {
    return new StoreError("PRECONDITION_FAILED", `Precondition failed for ${key}`);
  }
  if (status === 501 || status === 400) {
    return new StoreError("REMOTE_UNSUPPORTED", `Remote rejected ${key} (${status})`);
  }
  return new StoreError("REMOTE_UNSUPPORTED", `S3 HTTP ${status} for ${key}`);
}

export class S3ObjectStore implements ObjectStore {
  private readonly config: RemoteConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: RemoteConfig, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  urlFor(key: string): string {
    return objectUrl({
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      key,
      forcePathStyle: this.config.forcePathStyle,
    });
  }

  async get(key: string): Promise<ObjectBody | null> {
    const response = await this.send("GET", this.urlFor(key), new Uint8Array(), {});
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw mapStatus(response.status, key) ?? new StoreError("REMOTE_UNSUPPORTED", "GET failed");
    }
    const body = new Uint8Array(await response.arrayBuffer());
    const etag = stripQuotes(response.headers.get("etag"));
    if (!etag) {
      throw new StoreError("REMOTE_UNSUPPORTED", "GET missing ETag");
    }
    const contentType = response.headers.get("content-type") ?? undefined;
    return {
      body,
      etag,
      contentType,
      contentLength: body.byteLength,
    };
  }

  async head(key: string): Promise<HeadResult | null> {
    const response = await this.send("HEAD", this.urlFor(key), new Uint8Array(), {});
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw mapStatus(response.status, key) ?? new StoreError("REMOTE_UNSUPPORTED", "HEAD failed");
    }
    const etag = stripQuotes(response.headers.get("etag"));
    if (!etag) {
      throw new StoreError("REMOTE_UNSUPPORTED", "HEAD missing ETag");
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    const contentType = response.headers.get("content-type") ?? undefined;
    const lastModified = response.headers.get("last-modified") ?? undefined;
    const result: HeadResult = {
      etag,
      contentLength: Number.isFinite(length) ? length : 0,
    };
    if (contentType) {
      result.contentType = contentType;
    }
    if (lastModified) {
      result.lastModified = lastModified;
    }
    return result;
  }

  async put(
    key: string,
    body: Uint8Array,
    options?: PutOptions,
  ): Promise<{ etag: string }> {
    const extra: Record<string, string> = {
      "content-type": options?.contentType ?? "application/octet-stream",
    };
    if (options?.ifMatch) {
      extra["if-match"] = options.ifMatch;
    }
    if (options?.ifNoneMatch) {
      extra["if-none-match"] = options.ifNoneMatch;
    }
    if (options?.forbidOverwrite) {
      extra["x-oss-forbid-overwrite"] = "true";
    }
    const response = await this.send("PUT", this.urlFor(key), body, extra);
    if (!response.ok) {
      throw (
        mapStatus(response.status, key) ??
        new StoreError("REMOTE_UNSUPPORTED", "PUT failed")
      );
    }
    const etag = stripQuotes(response.headers.get("etag"));
    if (!etag) {
      throw new StoreError("REMOTE_UNSUPPORTED", "PUT missing ETag");
    }
    return { etag };
  }

  async delete(key: string, options?: DeleteOptions): Promise<void> {
    const extra: Record<string, string> = {};
    if (options?.ifMatch) {
      extra["if-match"] = options.ifMatch;
    }
    const response = await this.send("DELETE", this.urlFor(key), new Uint8Array(), extra);
    if (response.status === 404) {
      return;
    }
    if (!response.ok) {
      throw (
        mapStatus(response.status, key) ??
        new StoreError("REMOTE_UNSUPPORTED", "DELETE failed")
      );
    }
  }

  async list(prefix: string, options?: ListOptions): Promise<ListResult> {
    const root = new URL(this.urlFor(""));
    const params = new URLSearchParams();
    params.set("list-type", "2");
    params.set("prefix", prefix);
    if (options?.maxKeys != null) {
      params.set("max-keys", String(options.maxKeys));
    }
    if (options?.continuationToken) {
      params.set("continuation-token", options.continuationToken);
    }
    root.search = params.toString();
    const response = await this.send("GET", root.toString(), new Uint8Array(), {});
    if (!response.ok) {
      throw (
        mapStatus(response.status, prefix) ??
        new StoreError("REMOTE_UNSUPPORTED", "LIST failed")
      );
    }
    const xml = await response.text();
    return parseListXml(xml);
  }

  private async send(
    method: string,
    url: string,
    body: Uint8Array,
    extraHeaders: Record<string, string>,
  ): Promise<Response> {
    const signed = await signAwsV4({
      method,
      url,
      headers: extraHeaders,
      body,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region ?? "us-east-1",
    });
    const headers = new Headers();
    for (const [key, value] of Object.entries(signed.headers)) {
      if (key === "host") {
        continue;
      }
      headers.set(key, value);
    }
    const init: RequestInit = {
      method,
      headers,
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    };
    if (method !== "GET" && method !== "HEAD") {
      // Copy the view so fetch sends only this object's bytes.
      init.body = body.slice();
    }
    return this.fetchImpl(url, init);
  }
}

export function parseListXml(xml: string): ListResult {
  const keys: ListResult["keys"] = [];
  const contents = xml.matchAll(
    /<Contents>[\s\S]*?<Key>([^<]*)<\/Key>[\s\S]*?<Size>([^<]*)<\/Size>[\s\S]*?(?:<ETag>([^<]*)<\/ETag>)?[\s\S]*?<\/Contents>/g,
  );
  for (const match of contents) {
    const item: ListResult["keys"][number] = {
      key: decodeXml(match[1] ?? ""),
      size: Number(match[2] ?? "0"),
    };
    if (match[3]) {
      item.etag = decodeXml(match[3]);
    }
    keys.push(item);
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const tokenMatch = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
  const result: ListResult = { keys, isTruncated: truncated };
  if (tokenMatch?.[1]) {
    result.nextContinuationToken = decodeXml(tokenMatch[1]);
  }
  return result;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&apos;", "'");
}

export { headerMap };
