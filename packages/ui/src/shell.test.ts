import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TABLET_SHELL_MAX_PX,
  TOUCH_MIN_PX,
  NAV_ITEMS,
  navButtonStyle,
  paneFromLocation,
  pathForPane,
  pickAppShell,
  tabletChrome,
} from "./shell.ts";
import { buildHeatmapDays, heatLevel, isoDay } from "./heatmap.ts";
import { layoutVersionGraph } from "./version-graph.ts";

test("landscape uses left sidebar chrome", () => {
  assert.equal(tabletChrome(1280, 800), "sidebar");
  assert.equal(tabletChrome(800, 800), "sidebar");
});

test("portrait uses bottom bar chrome", () => {
  assert.equal(tabletChrome(800, 1280), "bottom");
});

test("web narrow width uses the tablet shell", () => {
  assert.equal(pickAppShell(TABLET_SHELL_MAX_PX), "tablet");
  assert.equal(pickAppShell(390), "tablet");
  assert.equal(pickAppShell(TABLET_SHELL_MAX_PX + 1), "desktop");
});

test("Android Pad always uses the tablet shell even on a wide Pixel Tablet", () => {
  assert.equal(pickAppShell(2560, true), "tablet");
  assert.equal(tabletChrome(2560, 1600), "sidebar");
  assert.equal(tabletChrome(1600, 2560), "bottom");
});

test("primary nav touch targets are at least 44px", () => {
  assert.equal(TOUCH_MIN_PX, 44);
  const style = navButtonStyle();
  assert.ok(style.minWidth >= 44);
  assert.ok(style.minHeight >= 44);
});

test("nav items match prototype: overview workspace assets kanban", () => {
  assert.deepEqual(
    NAV_ITEMS.map((item) => item.id),
    ["overview", "library", "assets", "kanban"],
  );
  assert.equal(NAV_ITEMS.find((item) => item.id === "library")?.label, "工作区");
});

test("heatmap counts local-day timestamps into cells", () => {
  const now = new Date(2026, 8, 16);
  const days = buildHeatmapDays(now, ["2026-09-16T12:00:00"], 2);
  const hit = days.find((day) => day.iso === isoDay(now));
  assert.equal(hit?.count, 1);
  assert.equal(heatLevel(0), 0);
  assert.equal(heatLevel(8), 4);
});

test("version graph forks a second lane for a named branch", () => {
  const layout = layoutVersionGraph(
    [
      { id: "a", parentSnapshotId: null, branch: "main", message: "root" },
      { id: "b", parentSnapshotId: "a", branch: "main", message: "m" },
      { id: "c", parentSnapshotId: "a", branch: "尝试A", message: "alt" },
    ],
    [
      { name: "main", snapshotId: "b" },
      { name: "尝试A", snapshotId: "c" },
    ],
    "c",
  );
  const main = layout.nodes.find((node) => node.id === "b");
  const alt = layout.nodes.find((node) => node.id === "c");
  assert.ok(main && alt);
  assert.notEqual(main.x, alt.x);
  assert.equal(alt.current, true);
  assert.ok(layout.labels.some((label) => label.branch === "主线"));
});

test("paneFromLocation maps /workspace and hashes", () => {
  assert.equal(paneFromLocation("/workspace"), "library");
  assert.equal(paneFromLocation("/assets"), "assets");
  assert.equal(paneFromLocation("/kanban"), "kanban");
  assert.equal(paneFromLocation("/"), "overview");
  assert.equal(paneFromLocation("/", "#workspace"), "library");
  assert.equal(pathForPane("library"), "/workspace");
});
