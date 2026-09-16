import type { TreeNode } from "@art-stock/core";
import { FileIcon, FolderIcon } from "@art-stock/ui";
import { childNodes } from "./tree-util.ts";

export { childNodes } from "./tree-util.ts";

export function FolderTree(props: {
  nodes: TreeNode[];
  parentId?: string | null;
  selectedId: string;
  onSelect: (node: TreeNode) => void;
}) {
  const kids = childNodes(props.nodes, props.parentId ?? null);
  if (kids.length === 0) {
    return null;
  }
  return (
    <ul className="as-tree">
      {kids.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            className={props.selectedId === node.id ? "is-active" : undefined}
            aria-current={props.selectedId === node.id ? "true" : undefined}
            onClick={() => props.onSelect(node)}
          >
            {node.kind === "folder" ? <FolderIcon width={16} height={16} /> : <FileIcon width={16} height={16} />}
            {node.name}
          </button>
          {node.kind === "folder" ? (
            <FolderTree
              nodes={props.nodes}
              parentId={node.id}
              selectedId={props.selectedId}
              onSelect={props.onSelect}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
