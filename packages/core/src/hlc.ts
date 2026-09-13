import type { Hlc } from "./types.ts";

export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.ts !== b.ts) {
    return a.ts < b.ts ? -1 : 1;
  }
  if (a.c !== b.c) {
    return a.c < b.c ? -1 : 1;
  }
  if (a.deviceId === b.deviceId) {
    return 0;
  }
  return a.deviceId < b.deviceId ? -1 : 1;
}

export type HlcClock = {
  deviceId: string;
  last: Hlc | null;
};

export function createHlcClock(deviceId: string, last: Hlc | null = null): HlcClock {
  return { deviceId, last };
}

/** Hybrid logical clock: ts, then counter, then deviceId. */
export function tickHlc(clock: HlcClock, nowMs: number = Date.now()): Hlc {
  const last = clock.last;
  const next: Hlc =
    last && nowMs <= last.ts
      ? { ts: last.ts, c: last.c + 1, deviceId: clock.deviceId }
      : { ts: nowMs, c: 0, deviceId: clock.deviceId };
  clock.last = next;
  return next;
}

export function formatHlcStamp(hlc: Hlc): string {
  return `${hlc.ts}.${hlc.c}`;
}
