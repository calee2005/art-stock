import assert from "node:assert/strict";
import { test } from "node:test";
import { createHlcClock, tickHlc } from "./hlc.ts";
import {
  addToOrSet,
  emptyOrSet,
  mergeOrSets,
  removeFromOrSet,
  valuesOfOrSet,
} from "./orset.ts";

test("OR-Set merge unions adds from two replicas", () => {
  const clockA = createHlcClock("dev-a");
  const clockB = createHlcClock("dev-b");
  const a = addToOrSet(emptyOrSet(), "角色", tickHlc(clockA, 1000));
  const b = addToOrSet(emptyOrSet(), "立绘", tickHlc(clockB, 1001));
  assert.deepEqual(valuesOfOrSet(mergeOrSets(a, b)), ["立绘", "角色"]);
});

test("OR-Set remove wins over earlier add", () => {
  const clock = createHlcClock("dev-a");
  let set = addToOrSet(emptyOrSet(), "旧", tickHlc(clock, 10));
  set = removeFromOrSet(set, "旧", tickHlc(clock, 20));
  assert.deepEqual(valuesOfOrSet(set), []);
});

test("OR-Set add after remove with later HLC brings the tag back", () => {
  const clock = createHlcClock("dev-a");
  let set = addToOrSet(emptyOrSet(), "角色", tickHlc(clock, 10));
  set = removeFromOrSet(set, "角色", tickHlc(clock, 20));
  set = addToOrSet(set, "角色", tickHlc(clock, 30));
  assert.deepEqual(valuesOfOrSet(set), ["角色"]);
});

test("OR-Set concurrent add is not covered by earlier remove on another replica", () => {
  const clockA = createHlcClock("dev-a");
  const clockB = createHlcClock("dev-b");
  const a = removeFromOrSet(
    addToOrSet(emptyOrSet(), "角色", tickHlc(clockA, 10)),
    "角色",
    tickHlc(clockA, 20),
  );
  const b = addToOrSet(emptyOrSet(), "角色", tickHlc(clockB, 30));
  assert.deepEqual(valuesOfOrSet(mergeOrSets(a, b)), ["角色"]);
});
