import { SCHEMA_VERSION } from "./types.ts";

export type MindNode = {
  id: string;
  text: string;
  children: MindNode[];
  color?: string;
  collapsed?: boolean;
};

export type MindDoc = {
  schemaVersion: 1;
  root: MindNode;
};

export function isMindmapName(name: string): boolean {
  return (
    /\.(mindmap|mind)$/i.test(name) ||
    (/\.json$/i.test(name) && /mind/i.test(name))
  );
}

export function createMindNode(text: string, children: MindNode[] = []): MindNode {
  return { id: crypto.randomUUID(), text, children };
}

export function createMindDoc(rootText = "中心主题"): MindDoc {
  return { schemaVersion: SCHEMA_VERSION, root: createMindNode(rootText) };
}

export function encodeMindDoc(doc: MindDoc): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(validateMindDoc(doc)));
}

export function parseMindDoc(bytes: Uint8Array): MindDoc {
  const text = new TextDecoder().decode(bytes);
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("MindDoc must be JSON, not a private binary");
  }
  return validateMindDoc(raw);
}

export function validateMindDoc(raw: unknown): MindDoc {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("MindDoc must be a JSON object");
  }
  const doc = raw as { schemaVersion?: unknown; root?: unknown };
  if (doc.schemaVersion !== 1) {
    throw new Error("MindDoc.schemaVersion must be 1");
  }
  return { schemaVersion: 1, root: validateMindNode(doc.root, new Set()) };
}

function validateMindNode(raw: unknown, seen: Set<string>): MindNode {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("MindNode must be a JSON object");
  }
  const node = raw as Record<string, unknown>;
  if (typeof node.id !== "string" || node.id.length === 0) {
    throw new Error("MindNode.id required");
  }
  if (seen.has(node.id)) {
    throw new Error(`duplicate MindNode id ${node.id}`);
  }
  seen.add(node.id);
  if (typeof node.text !== "string") {
    throw new Error("MindNode.text required");
  }
  if (!Array.isArray(node.children)) {
    throw new Error("MindNode.children must be an array");
  }
  const children = node.children.map((child) => validateMindNode(child, seen));
  const next: MindNode = { id: node.id, text: node.text, children };
  if (typeof node.color === "string") {
    next.color = node.color;
  }
  if (typeof node.collapsed === "boolean") {
    next.collapsed = node.collapsed;
  }
  return next;
}

export function findMindNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) {
    return root;
  }
  for (const child of root.children) {
    const found = findMindNode(child, id);
    if (found) {
      return found;
    }
  }
  return null;
}

function mapNode(
  root: MindNode,
  id: string,
  update: (node: MindNode) => MindNode | null,
): MindNode | null {
  if (root.id === id) {
    return update(root);
  }
  const children: MindNode[] = [];
  for (const child of root.children) {
    const mapped = mapNode(child, id, update);
    if (mapped) {
      children.push(mapped);
    }
  }
  return { ...root, children };
}

export function addMindChild(
  doc: MindDoc,
  parentId: string,
  text: string,
): MindDoc {
  if (!findMindNode(doc.root, parentId)) {
    throw new Error(`MindNode not found: ${parentId}`);
  }
  const child = createMindNode(text);
  const root = mapNode(doc.root, parentId, (node) => ({
    ...node,
    children: [...node.children, child],
  }));
  return { schemaVersion: 1, root: root! };
}

export function setMindNodeText(
  doc: MindDoc,
  nodeId: string,
  text: string,
): MindDoc {
  if (!findMindNode(doc.root, nodeId)) {
    throw new Error(`MindNode not found: ${nodeId}`);
  }
  const root = mapNode(doc.root, nodeId, (node) => ({ ...node, text }));
  return { schemaVersion: 1, root: root! };
}

export function removeMindNode(doc: MindDoc, nodeId: string): MindDoc {
  if (doc.root.id === nodeId) {
    throw new Error("cannot remove root");
  }
  const root = mapNode(doc.root, nodeId, () => null);
  if (!root) {
    throw new Error(`MindNode not found: ${nodeId}`);
  }
  return { schemaVersion: 1, root };
}
