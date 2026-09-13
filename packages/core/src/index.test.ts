import assert from "node:assert/strict";
import { test } from "node:test";
import { SCHEMA_VERSION } from "./index.ts";

test("@art-stock/core placeholder exports schemaVersion 1", () => {
  assert.equal(SCHEMA_VERSION, 1);
});
