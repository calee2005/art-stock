const DOW_LABELS = ["周一", "", "周四", "", "周日"] as const;
const DOW_FULL = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export type HeatDay = {
  iso: string;
  count: number;
};

const MONTHS_ZH = [
  "一月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "十二月",
];

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function mondayOnOrBefore(d: Date): Date {
  const day = d.getDay();
  const offset = day === 0 ? 6 : day - 1;
  const next = startOfDay(d);
  next.setDate(next.getDate() - offset);
  return next;
}

export function buildHeatmapDays(now: Date, timestamps: string[], weeks = 53): HeatDay[] {
  const end = startOfDay(now);
  const startMonday = mondayOnOrBefore(end);
  startMonday.setDate(startMonday.getDate() - (weeks - 1) * 7);
  const counts = new Map<string, number>();
  for (const stamp of timestamps) {
    const parsed = new Date(stamp);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }
    const key = isoDay(startOfDay(parsed));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days: HeatDay[] = [];
  const cursor = new Date(startMonday);
  const last = new Date(startMonday);
  last.setDate(last.getDate() + weeks * 7 - 1);
  while (cursor <= last) {
    const iso = isoDay(cursor);
    days.push({ iso, count: counts.get(iso) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) {
    return 0;
  }
  if (count === 1) {
    return 1;
  }
  if (count <= 3) {
    return 2;
  }
  if (count <= 6) {
    return 3;
  }
  return 4;
}

export function monthLabels(days: HeatDay[]): { label: string; week: number }[] {
  const seen = new Set<string>();
  const labels: { label: string; week: number }[] = [];
  days.forEach((day, index) => {
    const date = new Date(`${day.iso}T00:00:00`);
    if (date.getDate() > 7) {
      return;
    }
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    labels.push({
      label: MONTHS_ZH[date.getMonth()] ?? "",
      week: Math.floor(index / 7),
    });
  });
  return labels;
}

export { DOW_FULL, DOW_LABELS, MONTHS_ZH };
