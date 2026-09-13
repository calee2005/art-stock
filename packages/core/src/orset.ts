import { compareHlc } from "./hlc.ts";
import type { Hlc, OrSet, OrSetDot } from "./types.ts";

export type { OrSet, OrSetDot } from "./types.ts";

export function emptyOrSet(): OrSet {
  return { adds: [], removes: [] };
}

function sameDot(a: OrSetDot, b: OrSetDot): boolean {
  return a.value === b.value && compareHlc(a.hlc, b.hlc) === 0;
}

function unionDots(left: OrSetDot[], right: OrSetDot[]): OrSetDot[] {
  const merged = [...left];
  for (const item of right) {
    if (!merged.some((existing) => sameDot(existing, item))) {
      merged.push(item);
    }
  }
  return merged;
}

export function addToOrSet(set: OrSet, value: string, hlc: Hlc): OrSet {
  return {
    adds: unionDots(set.adds, [{ value, hlc }]),
    removes: set.removes,
  };
}

export function removeFromOrSet(set: OrSet, value: string, hlc: Hlc): OrSet {
  return {
    adds: set.adds,
    removes: unionDots(set.removes, [{ value, hlc }]),
  };
}

export function mergeOrSets(a: OrSet, b: OrSet): OrSet {
  return {
    adds: unionDots(a.adds, b.adds),
    removes: unionDots(a.removes, b.removes),
  };
}

/**
 * A value is present iff some add is not covered by a remove with HLC >= that add.
 * Protocol §6: 删除胜于更早的增加.
 */
export function valuesOfOrSet(set: OrSet): string[] {
  const present = new Set<string>();
  for (const add of set.adds) {
    const covered = set.removes.some(
      (rem) => rem.value === add.value && compareHlc(rem.hlc, add.hlc) >= 0,
    );
    if (!covered) {
      present.add(add.value);
    }
  }
  return [...present].sort();
}

export function orSetFromTags(tags: string[], hlc: Hlc): OrSet {
  return tags.reduce((set, tag) => addToOrSet(set, tag, hlc), emptyOrSet());
}
