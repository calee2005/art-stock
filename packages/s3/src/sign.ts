const encoder = new TextEncoder();

export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const byte of view) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

export async function sha256Hex(data: BufferSource | string): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", toBufferSource(bytes));
  return toHex(digest);
}

function bytesToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function toBufferSource(data: BufferSource | Uint8Array): BufferSource {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  return bytesToArrayBuffer(data instanceof Uint8Array ? data : new Uint8Array(data.buffer));
}

async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    bytesToArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return new Uint8Array(sig);
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** S3 canonical URI: encode each segment, keep slashes. */
export function canonicalUri(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return path
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

export function canonicalQuery(searchParams: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  searchParams.forEach((value, key) => {
    pairs.push([encodeRfc3986(key), encodeRfc3986(value)]);
  });
  pairs.sort((left, right) => {
    const a = left[0];
    const b = right[0];
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  });
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

export type SignRequestInput = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  now?: Date;
};

export type SignedRequest = {
  headers: Record<string, string>;
  amzDate: string;
  authorization: string;
  payloadHash: string;
};

export async function signAwsV4(input: SignRequestInput): Promise<SignedRequest> {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const region = input.region || "us-east-1";
  const service = input.service ?? "s3";
  const payloadHash =
    input.body.byteLength === 0 ? EMPTY_SHA256 : await sha256Hex(toBufferSource(input.body));
  const parsed = new URL(input.url);
  const host =
    parsed.port && parsed.port !== "80" && parsed.port !== "443"
      ? parsed.host
      : parsed.hostname;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers)) {
    headers[key.toLowerCase()] = value.trim();
  }
  headers.host = host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = payloadHash;

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");
  const signedHeaders = signedNames.join(";");
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(parsed.pathname),
    canonicalQuery(parsed.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  headers.authorization = authorization;
  return { headers, amzDate, authorization, payloadHash };
}
