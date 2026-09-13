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
import { objectUrl } from "./url.ts";

/**
 * Real S3 HTTP client stub (F-002).
 * URL addressing is configurable; signed requests land with later features.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly config: RemoteConfig;

  constructor(config: RemoteConfig) {
    this.config = config;
  }

  urlFor(key: string): string {
    return objectUrl({
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      key,
      forcePathStyle: this.config.forcePathStyle,
    });
  }

  get(_key: string): Promise<ObjectBody | null> {
    return Promise.reject(notImplemented("get"));
  }

  head(_key: string): Promise<HeadResult | null> {
    return Promise.reject(notImplemented("head"));
  }

  put(
    _key: string,
    _body: Uint8Array,
    _options?: PutOptions,
  ): Promise<{ etag: string }> {
    return Promise.reject(notImplemented("put"));
  }

  delete(_key: string, _options?: DeleteOptions): Promise<void> {
    return Promise.reject(notImplemented("delete"));
  }

  list(_prefix: string, _options?: ListOptions): Promise<ListResult> {
    return Promise.reject(notImplemented("list"));
  }
}

function notImplemented(method: string): StoreError {
  return new StoreError(
    "REMOTE_UNSUPPORTED",
    `S3ObjectStore.${method} HTTP is stubbed in F-002; use MemoryObjectStore in tests`,
  );
}
