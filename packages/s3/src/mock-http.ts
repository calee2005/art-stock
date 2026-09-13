import http from "node:http";
import { MemoryObjectStore, StoreError } from "@art-stock/core";

function cors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, If-Match, If-None-Match, x-oss-forbid-overwrite, x-amz-content-sha256, x-amz-date, x-amz-security-token",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "ETag, Content-Type, Content-Length");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parsePathStyle(
  url: URL,
  fallbackBucket: string,
): { bucket: string; key: string } {
  const parts = url.pathname.replace(/^\/+/, "").split("/");
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "")) {
    return { bucket: fallbackBucket, key: "" };
  }
  const bucket = parts[0] || fallbackBucket;
  const key = parts.slice(1).join("/");
  return { bucket, key };
}

async function readBody(req: http.IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export type S3Mock = {
  url: string;
  store: MemoryObjectStore;
  close: () => Promise<void>;
  port: number;
};

export async function listenS3Mock(options?: {
  port?: number;
  bucket?: string;
  accessKeyId?: string;
  store?: MemoryObjectStore;
}): Promise<S3Mock> {
  const bucket = options?.bucket ?? "art";
  const accessKeyId = options?.accessKeyId ?? "AKIATEST";
  const store = options?.store ?? new MemoryObjectStore();
  const server = http.createServer((req, res) => {
    void (async () => {
      cors(res);
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }
      const host = req.headers.host ?? "127.0.0.1";
      const url = new URL(req.url ?? "/", `http://${host}`);
      const auth = req.headers.authorization ?? "";
      if (req.method !== "OPTIONS" && !auth.includes(accessKeyId)) {
        res.statusCode = 403;
        res.end("forbidden");
        return;
      }
      const parsed = parsePathStyle(url, bucket);
      const key = parsed.key;
      try {
        if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
          const prefix = url.searchParams.get("prefix") ?? "";
          const listed = await store.list(prefix, {
            maxKeys: url.searchParams.has("max-keys")
              ? Number(url.searchParams.get("max-keys"))
              : undefined,
            continuationToken: url.searchParams.get("continuation-token") ?? undefined,
          });
          const contents = listed.keys
            .map(
              (item) =>
                `<Contents><Key>${xmlEscape(item.key)}</Key><Size>${item.size}</Size><ETag>${xmlEscape(item.etag ?? "")}</ETag></Contents>`,
            )
            .join("");
          const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>${listed.isTruncated}</IsTruncated>${contents}${
            listed.nextContinuationToken
              ? `<NextContinuationToken>${xmlEscape(listed.nextContinuationToken)}</NextContinuationToken>`
              : ""
          }</ListBucketResult>`;
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/xml");
          res.end(xml);
          return;
        }
        if (req.method === "GET" || req.method === "HEAD") {
          const got = await store.get(key);
          if (!got) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader("ETag", got.etag);
          res.setHeader("Content-Length", String(got.contentLength));
          if (got.contentType) {
            res.setHeader("Content-Type", got.contentType);
          }
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          res.end(Buffer.from(got.body));
          return;
        }
        if (req.method === "PUT") {
          const body = await readBody(req);
          const result = await store.put(key, body, {
            contentType: header(req, "content-type"),
            ifMatch: header(req, "if-match"),
            ifNoneMatch: header(req, "if-none-match"),
            forbidOverwrite: header(req, "x-oss-forbid-overwrite") === "true",
          });
          res.statusCode = 200;
          res.setHeader("ETag", result.etag);
          res.end();
          return;
        }
        if (req.method === "DELETE") {
          await store.delete(key, { ifMatch: header(req, "if-match") });
          res.statusCode = 204;
          res.end();
          return;
        }
        res.statusCode = 405;
        res.end();
      } catch (error) {
        if (error instanceof StoreError && error.code === "PRECONDITION_FAILED") {
          res.statusCode = 412;
          res.end("precondition");
          return;
        }
        res.statusCode = 500;
        res.end("error");
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(options?.port ?? 0, "0.0.0.0", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("S3 mock failed to bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    store,
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
