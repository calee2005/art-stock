import { StoreError } from "./store-error.ts";

export type PutConditions = {
  /** Existing object ETag must match (S3 If-Match). */
  ifMatch?: string;
  /** Typically `"*"`: object must not exist (S3 If-None-Match). */
  ifNoneMatch?: string;
  /** Aliyun OSS `x-oss-forbid-overwrite: true`. Same effect as If-None-Match: *. */
  forbidOverwrite?: boolean;
};

export type PutOptions = PutConditions & {
  contentType?: string;
};

export type DeleteOptions = {
  ifMatch?: string;
};

export type ObjectBody = {
  body: Uint8Array;
  etag: string;
  contentType?: string;
  contentLength: number;
};

export type HeadResult = {
  etag: string;
  contentLength: number;
  contentType?: string;
  lastModified?: string;
};

export type ListObject = {
  key: string;
  size: number;
  etag?: string;
};

export type ListOptions = {
  continuationToken?: string;
  maxKeys?: number;
};

export type ListResult = {
  keys: ListObject[];
  isTruncated: boolean;
  nextContinuationToken?: string;
};

export type ObjectStore = {
  get(key: string): Promise<ObjectBody | null>;
  head(key: string): Promise<HeadResult | null>;
  put(key: string, body: Uint8Array, options?: PutOptions): Promise<{ etag: string }>;
  delete(key: string, options?: DeleteOptions): Promise<void>;
  list(prefix: string, options?: ListOptions): Promise<ListResult>;
};

type MemoryRecord = {
  body: Uint8Array;
  etag: string;
  contentType?: string;
  lastModified: string;
};

export type MemoryObjectStoreOptions = {
  /** When false, any conditional header is rejected as REMOTE_UNSUPPORTED. */
  conditionalWrites?: boolean;
};

function cloneBytes(body: Uint8Array): Uint8Array {
  return body.slice();
}

/** Portable non-crypto tag for the mock; uniqueness is enough for If-Match tests. */
function etagFor(body: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of body) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `"${hex}${body.byteLength.toString(16).padStart(8, "0")}"`;
}

function mustNotExist(options: PutConditions | undefined): boolean {
  return options?.forbidOverwrite === true || options?.ifNoneMatch === "*";
}

/**
 * In-memory S3-compatible store for unit tests.
 * Honors If-Match / If-None-Match / x-oss-forbid-overwrite.
 */
export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, MemoryRecord>();
  private readonly conditionalWrites: boolean;

  constructor(options: MemoryObjectStoreOptions = {}) {
    this.conditionalWrites = options.conditionalWrites ?? true;
  }

  private assertConditionalAllowed(
    options: PutConditions | DeleteOptions | undefined,
  ): void {
    if (this.conditionalWrites) {
      return;
    }
    const hasCondition =
      options != null &&
      ("ifMatch" in options ||
        "ifNoneMatch" in options ||
        "forbidOverwrite" in options) &&
      (options.ifMatch != null ||
        ("ifNoneMatch" in options && options.ifNoneMatch != null) ||
        ("forbidOverwrite" in options && options.forbidOverwrite === true));
    if (hasCondition) {
      throw new StoreError(
        "REMOTE_UNSUPPORTED",
        "Remote does not support conditional writes",
      );
    }
  }

  async get(key: string): Promise<ObjectBody | null> {
    const record = this.objects.get(key);
    if (!record) {
      return null;
    }
    return {
      body: cloneBytes(record.body),
      etag: record.etag,
      contentType: record.contentType,
      contentLength: record.body.byteLength,
    };
  }

  async head(key: string): Promise<HeadResult | null> {
    const record = this.objects.get(key);
    if (!record) {
      return null;
    }
    return {
      etag: record.etag,
      contentLength: record.body.byteLength,
      contentType: record.contentType,
      lastModified: record.lastModified,
    };
  }

  async put(
    key: string,
    body: Uint8Array,
    options?: PutOptions,
  ): Promise<{ etag: string }> {
    this.assertConditionalAllowed(options);
    const existing = this.objects.get(key);
    const forbidCreateOverlap = mustNotExist(options);

    if (forbidCreateOverlap && existing) {
      throw new StoreError(
        "PRECONDITION_FAILED",
        `Object already exists: ${key}`,
      );
    }
    if (options?.ifMatch != null) {
      if (!existing || existing.etag !== options.ifMatch) {
        throw new StoreError(
          "PRECONDITION_FAILED",
          `If-Match failed for ${key}`,
        );
      }
    }

    const stored = cloneBytes(body);
    const etag = etagFor(stored);
    const record: MemoryRecord = {
      body: stored,
      etag,
      lastModified: new Date().toISOString(),
    };
    if (options?.contentType != null) {
      record.contentType = options.contentType;
    }
    this.objects.set(key, record);
    return { etag };
  }

  async delete(key: string, options?: DeleteOptions): Promise<void> {
    this.assertConditionalAllowed(options);
    const existing = this.objects.get(key);
    if (options?.ifMatch != null) {
      if (!existing || existing.etag !== options.ifMatch) {
        throw new StoreError(
          "PRECONDITION_FAILED",
          `If-Match delete failed for ${key}`,
        );
      }
    }
    this.objects.delete(key);
  }

  async list(prefix: string, options?: ListOptions): Promise<ListResult> {
    const maxKeys = options?.maxKeys ?? 1000;
    const sorted = [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    const start = options?.continuationToken
      ? sorted.findIndex((key) => key > options.continuationToken!)
      : 0;
    const from = start < 0 ? sorted.length : start;
    const slice = sorted.slice(from, from + maxKeys);
    const isTruncated = from + slice.length < sorted.length;
    const last = slice.at(-1);
    return {
      keys: slice.map((key) => {
        const record = this.objects.get(key)!;
        return {
          key,
          size: record.body.byteLength,
          etag: record.etag,
        };
      }),
      isTruncated,
      nextContinuationToken: isTruncated ? last : undefined,
    };
  }
}
