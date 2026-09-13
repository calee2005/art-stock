export type ObjectUrlInput = {
  endpoint: string;
  bucket: string;
  key: string;
  forcePathStyle: boolean;
};

function splitEndpoint(endpoint: string): {
  origin: string;
  host: string;
  path: string;
} {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/]+)(\/.*)?$/i.exec(endpoint.trim());
  if (!match) {
    throw new Error(`Invalid S3 endpoint: ${endpoint}`);
  }
  const origin = `${match[1]}${match[2]}`;
  const host = match[2] ?? "";
  const path = (match[3] ?? "").replace(/\/+$/, "");
  return { origin, host, path };
}

function joinKey(path: string, ...parts: string[]): string {
  const segments = [...path.split("/"), ...parts]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter((part) => part.length > 0);
  return `/${segments.join("/")}`;
}

/**
 * Build an object URL.
 * Path-style: `{endpoint}/{bucket}/{key}` (typical MinIO / NAS).
 * Virtual-hosted: `{bucket}.{endpoint-host}/{key}` (typical Aliyun OSS / AWS).
 */
export function objectUrl(input: ObjectUrlInput): string {
  const key = input.key.replace(/^\/+/, "");
  const { origin, host, path } = splitEndpoint(input.endpoint.replace(/\/+$/, ""));
  if (input.forcePathStyle) {
    return `${origin}${joinKey(path, input.bucket, key)}`;
  }
  const protocol = origin.slice(0, origin.length - host.length);
  return `${protocol}${input.bucket}.${host}${joinKey(path, key)}`;
}

export function addressingStyle(
  forcePathStyle: boolean,
): "path" | "virtual-hosted" {
  return forcePathStyle ? "path" : "virtual-hosted";
}
