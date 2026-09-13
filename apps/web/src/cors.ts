import { objectUrl } from "@art-stock/s3";

/** Lock-condition headers required by protocol §12 / withRemoteLock(). */
export const CORS_LOCK_HEADERS = [
  "If-Match",
  "If-None-Match",
  "x-oss-forbid-overwrite",
] as const;

export const CORS_ALLOWED_METHODS = [
  "GET",
  "HEAD",
  "PUT",
  "DELETE",
  "POST",
] as const;

export const CORS_ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "If-Match",
  "If-None-Match",
  "x-oss-forbid-overwrite",
  "x-amz-content-sha256",
  "x-amz-date",
  "x-amz-security-token",
] as const;

export const CORS_EXPOSE_HEADERS = ["ETag"] as const;

export const CORS_ERROR_MESSAGE =
  "未配置 CORS 或浏览器拦截了跨域请求。把下方 JSON 贴到 OSS/S3 的 CORS 规则，必须放行 If-Match、If-None-Match、x-oss-forbid-overwrite。页面不会白屏，可继续改远端配置。";

export type OssCorsRule = {
  AllowedOrigins: string[];
  AllowedMethods: string[];
  AllowedHeaders: string[];
  ExposeHeaders: string[];
  MaxAgeSeconds: number;
};

export type OssCorsDocument = {
  CORSRules: OssCorsRule[];
};

export function pagesOriginFromLocation(
  locationLike: { origin: string } | undefined = globalThis.location,
): string | undefined {
  const origin = locationLike?.origin?.trim();
  if (!origin || origin === "null") {
    return undefined;
  }
  return origin;
}

export function defaultCorsOrigins(
  locationLike: { origin: string } | undefined = globalThis.location,
): string[] {
  const origins = ["http://localhost:5173", "http://127.0.0.1:5173"];
  const here = pagesOriginFromLocation(locationLike);
  if (here && !origins.includes(here)) {
    origins.unshift(here);
  } else if (!here) {
    origins.unshift("https://<user>.github.io");
  }
  return origins;
}

export function ossCorsDocument(origins?: string[]): OssCorsDocument {
  return {
    CORSRules: [
      {
        AllowedOrigins: origins && origins.length > 0 ? origins : defaultCorsOrigins(),
        AllowedMethods: [...CORS_ALLOWED_METHODS],
        AllowedHeaders: [...CORS_ALLOWED_HEADERS],
        ExposeHeaders: [...CORS_EXPOSE_HEADERS],
        MaxAgeSeconds: 600,
      },
    ],
  };
}

export function corsExampleJson(origins?: string[]): string {
  return `${JSON.stringify(ossCorsDocument(origins), null, 2)}\n`;
}

export function isCorsFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  if (
    error.name === "TypeError" &&
    /failed to fetch|networkerror|load failed|network request failed/.test(message)
  ) {
    return true;
  }
  if (error.name === "NetworkError") {
    return true;
  }
  return (
    message.includes("cors") ||
    message.includes("cross-origin") ||
    message.includes("access-control-allow-origin")
  );
}

export function describeCorsFailure(error: unknown): string {
  if (isCorsFailure(error)) {
    return CORS_ERROR_MESSAGE;
  }
  return error instanceof Error ? error.message : String(error);
}

export type CorsCheckResult =
  | { ok: true; url: string }
  | { ok: false; cors: true; url: string; message: string }
  | { ok: false; cors: false; url?: string; message: string };

export async function checkBucketCors(input: {
  endpoint: string;
  bucket: string;
  forcePathStyle: boolean;
  fetchImpl?: typeof fetch;
}): Promise<CorsCheckResult> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  let url: string;
  try {
    url = objectUrl({
      endpoint: input.endpoint.trim(),
      bucket: input.bucket.trim(),
      key: ".artstock/v1/manifest.json",
      forcePathStyle: input.forcePathStyle,
    });
  } catch (error) {
    return {
      ok: false,
      cors: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    // HEAD only — no Authorization. Keys never leave the browser form.
    await fetchImpl(url, { method: "HEAD", mode: "cors" });
    return { ok: true, url };
  } catch (error) {
    if (isCorsFailure(error)) {
      return { ok: false, cors: true, url, message: CORS_ERROR_MESSAGE };
    }
    return {
      ok: false,
      cors: false,
      url,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
