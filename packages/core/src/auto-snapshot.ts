import type { RemoteLockTarget } from "./lock.ts";
import type { Snapshot, SnapshotPolicy } from "./types.ts";
import { commitSnapshot } from "./versions.ts";

export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
  mode: "auto-on-save",
  minIntervalMs: 5000,
};

export type ClockScheduler = {
  now(): number;
  schedule(fn: () => void, delayMs: number): () => void;
};

export type AutoSnapshotResult =
  | { status: "skipped-manual"; objectId: string }
  | { status: "superseded"; objectId: string }
  | { status: "committed"; objectId: string; snapshot: Snapshot }
  | { status: "error"; objectId: string; message: string };

const defaultScheduler: ClockScheduler = {
  now: () => Date.now(),
  schedule(fn, delayMs) {
    const timer = setTimeout(fn, delayMs);
    return () => clearTimeout(timer);
  },
};

export function createManualClock(): ClockScheduler & {
  advance(ms: number): Promise<void>;
} {
  let now = 0;
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  return {
    now: () => now,
    schedule(fn, delayMs) {
      const timer = { at: now + delayMs, fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    async advance(ms: number) {
      now += ms;
      const due = timers
        .filter((timer) => !timer.cancelled && timer.at <= now)
        .sort((a, b) => a.at - b.at);
      for (const timer of due) {
        timer.cancelled = true;
        timer.fn();
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

/**
 * Debounced auto-on-save snapshots. Rapid local saves collapse to one
 * commitSnapshot after minIntervalMs of quiet.
 */
export function createAutoSnapshotController(options?: {
  scheduler?: ClockScheduler;
}) {
  const scheduler = options?.scheduler ?? defaultScheduler;
  const pending = new Map<string, { cancel: () => void }>();

  function cancel(objectId: string): void {
    pending.get(objectId)?.cancel();
    pending.delete(objectId);
  }

  function notifyFileSaved(
    remote: RemoteLockTarget,
    objectId: string,
    bytes: Uint8Array,
    policy: SnapshotPolicy = DEFAULT_SNAPSHOT_POLICY,
  ): Promise<AutoSnapshotResult> {
    if (policy.mode !== "auto-on-save") {
      return Promise.resolve({ status: "skipped-manual", objectId });
    }
    cancel(objectId);
    const wait = policy.minIntervalMs;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: AutoSnapshotResult) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };
      const cancelTimer = scheduler.schedule(() => {
        pending.delete(objectId);
        void commitSnapshot(remote, objectId, bytes, "auto-save")
          .then((snapshot) => {
            finish({ status: "committed", objectId, snapshot });
          })
          .catch((error: unknown) => {
            finish({
              status: "error",
              objectId,
              message: error instanceof Error ? error.message : "auto-save failed",
            });
          });
      }, wait);
      pending.set(objectId, {
        cancel: () => {
          cancelTimer();
          finish({ status: "superseded", objectId });
        },
      });
    });
  }

  return { notifyFileSaved, cancel };
}
