import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TABLET_SHELL_MAX_PX,
  TOUCH_MIN_PX,
  navButtonStyle,
  pickAppShell,
  tabletChrome,
} from "./shell.ts";

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

test("primary nav touch targets are at least 44px", () => {
  assert.equal(TOUCH_MIN_PX, 44);
  const style = navButtonStyle();
  assert.ok(style.minWidth >= 44);
  assert.ok(style.minHeight >= 44);
});
