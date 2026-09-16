import type { TreeNode } from "@art-stock/core";

export function childNodes(nodes: TreeNode[], parentId: string | null): TreeNode[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .slice()
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
}
