#!/usr/bin/env node
import { createInterface } from "node:readline";
import { MemoryObjectStore } from "@art-stock/core";
import { handleJsonRpc, type McpSession } from "./server.ts";

const session: McpSession = {
  remotes: [],
  store: new MemoryObjectStore(),
  prefix: "",
  deviceId: "mcp-cli",
  deviceName: "mcp-cli",
};

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) {
    continue;
  }
  const message = JSON.parse(line) as Parameters<typeof handleJsonRpc>[1];
  const reply = await handleJsonRpc(session, message);
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}
