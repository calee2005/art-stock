import { blobKey } from "./keys.ts";
import type { ObjectStore } from "./store.ts";

export type PinScope = "library" | "folder" | "object" | "asset";

export type Pin = {
  scope: PinScope;
  id: string;
};

/** Web/desktop localStorage key. Never a protocol/S3 object key. */
export const LOCAL_PIN_STORAGE_KEY = "art-stock.pins";

export type OriginalRef = {
  kind: "object" | "asset";
  id: string;
  blobSha256: string;
  libraryId?: string;
  folderId?: string | null;
  ancestorFolderIds?: string[];
};

export function pinEquals(a: Pin, b: Pin): boolean {
  return a.scope === b.scope && a.id === b.id;
}

export function hasPin(pins: readonly Pin[], pin: Pin): boolean {
  return pins.some((item) => pinEquals(item, pin));
}

export function addPin(pins: readonly Pin[], pin: Pin): Pin[] {
  if (hasPin(pins, pin)) {
    return [...pins];
  }
  return [...pins, { scope: pin.scope, id: pin.id }];
}

export function removePin(pins: readonly Pin[], pin: Pin): Pin[] {
  return pins.filter((item) => !pinEquals(item, pin));
}

export function parsePins(json: string): Pin[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  const scopes: PinScope[] = ["library", "folder", "object", "asset"];
  const pins: Pin[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      "scope" in item &&
      "id" in item &&
      typeof (item as Pin).id === "string" &&
      scopes.includes((item as Pin).scope)
    ) {
      pins.push({ scope: (item as Pin).scope, id: (item as Pin).id });
    }
  }
  return pins;
}

export function serializePins(pins: readonly Pin[]): string {
  return JSON.stringify(pins.map((pin) => ({ scope: pin.scope, id: pin.id })));
}

export function isOriginalPinned(
  pins: readonly Pin[],
  ref: OriginalRef,
): boolean {
  if (hasPin(pins, { scope: ref.kind, id: ref.id })) {
    return true;
  }
  if (ref.libraryId && hasPin(pins, { scope: "library", id: ref.libraryId })) {
    return true;
  }
  if (ref.folderId && hasPin(pins, { scope: "folder", id: ref.folderId })) {
    return true;
  }
  return Boolean(
    ref.ancestorFolderIds?.some((id) => hasPin(pins, { scope: "folder", id })),
  );
}

export function originalCacheKey(ref: Pick<OriginalRef, "kind" | "id">): string {
  return `${ref.kind}:${ref.id}`;
}

export type LocalOriginalCache = Map<string, Uint8Array>;

export async function fetchOriginalOnDemand(
  store: ObjectStore,
  prefix: string,
  cache: LocalOriginalCache,
  ref: OriginalRef,
  pins: readonly Pin[],
  options?: { pin?: boolean },
): Promise<{ bytes: Uint8Array; pins: Pin[] }> {
  const key = originalCacheKey(ref);
  let bytes = cache.get(key);
  if (!bytes) {
    const got = await store.get(blobKey(prefix, ref.blobSha256));
    if (!got) {
      throw new Error("CACHE_MISS");
    }
    bytes = got.body;
    cache.set(key, bytes);
  }
  let nextPins = [...pins];
  if (options?.pin) {
    nextPins = addPin(nextPins, { scope: ref.kind, id: ref.id });
  }
  return { bytes, pins: nextPins };
}

/** Drop unpinned originals locally. Remote blobs are not deleted. */
export function purgeUnpinnedOriginals(
  cache: LocalOriginalCache,
  pins: readonly Pin[],
  refs: readonly OriginalRef[],
): number {
  let removed = 0;
  for (const ref of refs) {
    const key = originalCacheKey(ref);
    if (!cache.has(key)) {
      continue;
    }
    if (!isOriginalPinned(pins, ref)) {
      cache.delete(key);
      removed += 1;
    }
  }
  return removed;
}
