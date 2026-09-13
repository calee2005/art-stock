import type { AssetItem } from "./types.ts";

/** Web MiniSearch snapshot in localStorage/IndexedDB. Never an S3 key. */
export const LOCAL_ASSET_SEARCH_KEY = "art-stock.asset-minisearch";

export type AssetSearchKind = "minisearch" | "sqlite-fts";

export type AssetSearchDoc = {
  id: string;
  name: string;
  tags: string[];
};

export type AssetSearchIndex = {
  kind: AssetSearchKind;
  docs: Map<string, AssetSearchDoc>;
  inverted: Map<string, Set<string>>;
};

/** Unicode letters/numbers; keeps CJK tags as whole tokens. */
export function tokenizeSearchText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

export function tokensForAsset(doc: AssetSearchDoc): string[] {
  const tokens = tokenizeSearchText(doc.name);
  for (const tag of doc.tags) {
    const trimmed = tag.trim();
    if (!trimmed) {
      continue;
    }
    tokens.push(...tokenizeSearchText(trimmed));
    const lower = trimmed.toLowerCase();
    if (!tokens.includes(lower)) {
      tokens.push(lower);
    }
  }
  return tokens;
}

export function createAssetSearchIndex(
  kind: AssetSearchKind = "minisearch",
): AssetSearchIndex {
  return { kind, docs: new Map(), inverted: new Map() };
}

export function removeAssetSearchDoc(index: AssetSearchIndex, id: string): void {
  const existing = index.docs.get(id);
  if (!existing) {
    return;
  }
  for (const token of tokensForAsset(existing)) {
    const posting = index.inverted.get(token);
    if (!posting) {
      continue;
    }
    posting.delete(id);
    if (posting.size === 0) {
      index.inverted.delete(token);
    }
  }
  index.docs.delete(id);
}

export function upsertAssetSearchDoc(
  index: AssetSearchIndex,
  doc: AssetSearchDoc,
): void {
  removeAssetSearchDoc(index, doc.id);
  const stored: AssetSearchDoc = {
    id: doc.id,
    name: doc.name,
    tags: [...doc.tags],
  };
  index.docs.set(doc.id, stored);
  for (const token of tokensForAsset(stored)) {
    let posting = index.inverted.get(token);
    if (!posting) {
      posting = new Set();
      index.inverted.set(token, posting);
    }
    posting.add(doc.id);
  }
}

export function rebuildAssetSearchIndex(
  assets: readonly Pick<AssetItem, "id" | "name" | "tags">[],
  kind: AssetSearchKind = "minisearch",
): AssetSearchIndex {
  const index = createAssetSearchIndex(kind);
  for (const asset of assets) {
    upsertAssetSearchDoc(index, {
      id: asset.id,
      name: asset.name,
      tags: asset.tags,
    });
  }
  return index;
}

function idsMatchingTerm(index: AssetSearchIndex, raw: string): Set<string> {
  const prefixRequested = raw.endsWith("*");
  const token = raw.toLowerCase().replace(/\*+$/, "");
  const prefix = prefixRequested || index.kind === "minisearch";
  const ids = new Set<string>();
  if (!token) {
    return ids;
  }
  if (!prefix) {
    const exact = index.inverted.get(token);
    if (exact) {
      for (const id of exact) {
        ids.add(id);
      }
    }
    return ids;
  }
  for (const [key, posting] of index.inverted) {
    if (key.startsWith(token)) {
      for (const id of posting) {
        ids.add(id);
      }
    }
  }
  return ids;
}

/** Space-separated AND, same as FTS5 default MATCH. */
export function parseFtsQuery(query: string): string[] {
  const terms: string[] = [];
  for (const raw of query.trim().split(/\s+/).filter(Boolean)) {
    const prefix = raw.endsWith("*");
    const pieces = tokenizeSearchText(raw.replace(/\*+$/, ""));
    for (const piece of pieces) {
      terms.push(prefix ? `${piece}*` : piece);
    }
  }
  return terms;
}

export function searchAssetIndex(
  index: AssetSearchIndex,
  query: string,
): string[] {
  const terms = parseFtsQuery(query);
  if (terms.length === 0) {
    return [...index.docs.keys()];
  }
  let current: Set<string> | null = null;
  for (const term of terms) {
    const next = idsMatchingTerm(index, term);
    if (!current) {
      current = next;
      continue;
    }
    current = new Set([...current].filter((id) => next.has(id)));
  }
  return [...(current ?? [])];
}

export function searchAssets<T extends Pick<AssetItem, "id" | "name" | "tags">>(
  assets: readonly T[],
  query: string,
  kind: AssetSearchKind = "minisearch",
): T[] {
  if (!query.trim()) {
    return [...assets];
  }
  const index = rebuildAssetSearchIndex(assets, kind);
  const hit = new Set(searchAssetIndex(index, query));
  return assets.filter((item) => hit.has(item.id));
}
