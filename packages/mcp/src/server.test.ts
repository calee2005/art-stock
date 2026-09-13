import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBoard,
  createLibrary,
  createWorkspace,
  listItems,
  listSnapshots,
  MemoryObjectStore,
} from "@art-stock/core";
import { callMcpTool, handleJsonRpc, type McpSession } from "./server.ts";

function session(store: MemoryObjectStore): McpSession {
  return {
    remotes: [{ id: "oss", name: "OSS", mode: "readwrite" }],
    store,
    prefix: "",
    deviceId: "mcp",
    deviceName: "mcp",
  };
}

test("MCP list_libraries, write_markdown, kanban_create_item; no secrets in results", async () => {
  const store = new MemoryObjectStore();
  const s = session(store);
  const remote = {
    store,
    prefix: "",
    deviceId: "mcp",
    deviceName: "mcp",
  };
  const lib = await createLibrary(remote, "MCP库");
  const listed = (await callMcpTool(s, "list_libraries")) as {
    libraries: { name: string }[];
  };
  assert.equal(listed.libraries[0]?.name, "MCP库");
  const remotes = (await callMcpTool(s, "list_remotes")) as {
    remotes: { id: string }[];
  };
  assert.equal(JSON.stringify(remotes).includes("secret"), false);
  assert.equal(JSON.stringify(remotes).includes("accessKey"), false);

  const written = (await callMcpTool(s, "write_markdown", {
    libraryId: lib.id,
    name: "note.md",
    text: "# hi",
  })) as { objectId: string; snapshotId: string };
  assert.ok(written.objectId);
  assert.equal((await listSnapshots(store, "", written.objectId)).length, 1);
  const text = (await callMcpTool(s, "read_object_text", {
    objectId: written.objectId,
  })) as { text: string };
  assert.match(text.text, /# hi/);

  const ws = await createWorkspace(remote, "W");
  const board = await createBoard(remote, ws.id, "B");
  const lists = (
    await callMcpTool(s, "kanban_list_items", { boardId: board.id })
  ) as { lists: { id: string }[] };
  const listId = lists.lists[0]?.id;
  assert.ok(listId);
  const item = (await callMcpTool(s, "kanban_create_item", {
    boardId: board.id,
    listId,
    title: "从 MCP 建",
  })) as { item: { title: string; listId: string } };
  assert.equal(item.item.title, "从 MCP 建");
  assert.equal(item.item.listId, listId);
  const all = await listItems(store, "", listId);
  assert.equal(all.some((row) => row.title === "从 MCP 建"), true);

  const rpc = await handleJsonRpc(s, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  const names = (
    rpc as { result: { tools: { name: string }[] } }
  ).result.tools.map((tool) => tool.name);
  assert.ok(names.includes("list_libraries"));
  assert.ok(names.includes("write_markdown"));
  assert.ok(names.includes("kanban_create_item"));
});
