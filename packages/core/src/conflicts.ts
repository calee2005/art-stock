import {
  createBranch,
  deleteBranch,
  getBranch,
  isConflictBranch,
  listConflictBranches,
  rollbackBranch,
  validateBranchName,
} from "./versions.ts";
import type { RemoteLockTarget } from "./lock.ts";
import type { ObjectStore } from "./store.ts";
import type { BranchPointer } from "./types.ts";

export type ConflictAction = "adopt-remote" | "adopt-local" | "keep-both";

export type ResolveConflictOptions = {
  keepAs?: string;
};

export function conflictBadgeCount(
  conflictBranches: number,
  failedOps = 0,
): number {
  return conflictBranches + failedOps;
}

export async function countUnresolvedConflicts(
  store: ObjectStore,
  prefix: string,
  objectIds: readonly string[],
  failedOps = 0,
): Promise<number> {
  let branches = 0;
  for (const objectId of objectIds) {
    branches += (await listConflictBranches(store, prefix, objectId)).length;
  }
  return conflictBadgeCount(branches, failedOps);
}

export async function resolveConflictBranch(
  remote: RemoteLockTarget,
  objectId: string,
  conflictName: string,
  action: ConflictAction,
  options?: ResolveConflictOptions,
): Promise<BranchPointer | void> {
  if (!isConflictBranch(conflictName)) {
    throw new Error("Not a conflict branch");
  }
  const prefix = remote.prefix ?? "";
  const conflict = await getBranch(remote.store, prefix, objectId, conflictName);
  if (!conflict) {
    throw new Error(`Conflict branch not found: ${conflictName}`);
  }
  const defaultName = "main";
  if (action === "adopt-remote") {
    await deleteBranch(remote, objectId, conflictName);
    return;
  }
  if (action === "adopt-local") {
    await rollbackBranch(
      remote,
      objectId,
      conflict.pointer.snapshotId,
      defaultName,
    );
    await deleteBranch(remote, objectId, conflictName);
    return;
  }
  const keepAs = validateBranchName(options?.keepAs ?? "kept");
  if (isConflictBranch(keepAs)) {
    throw new Error("keep-both name must not stay under conflict/");
  }
  const kept = await createBranch(remote, objectId, keepAs, conflictName);
  await deleteBranch(remote, objectId, conflictName);
  return kept;
}
