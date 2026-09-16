export type GraphSnapshot = {
  id: string;
  parentSnapshotId: string | null;
  branch: string;
  message: string;
};

export type GraphBranch = {
  name: string;
  snapshotId: string;
};

export type GraphNode = {
  id: string;
  x: number;
  y: number;
  branch: string;
  current: boolean;
};

export type GraphEdge = {
  from: string;
  to: string;
};

export type VersionLayout = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  labels: { branch: string; x: number; y: number }[];
};

const X_GAP = 88;
const Y_GAP = 56;

function childrenOf(snapshots: GraphSnapshot[], id: string): GraphSnapshot[] {
  return snapshots.filter((item) => item.parentSnapshotId === id);
}

export function layoutVersionGraph(
  snapshots: GraphSnapshot[],
  branches: GraphBranch[],
  activeSnapshotId?: string,
): VersionLayout {
  if (snapshots.length === 0) {
    return { nodes: [], edges: [], labels: [] };
  }
  const byId = new Map(snapshots.map((item) => [item.id, item]));
  const roots = snapshots.filter(
    (item) => !item.parentSnapshotId || !byId.has(item.parentSnapshotId),
  );
  const laneOf = new Map<string, number>();
  const depthOf = new Map<string, number>();
  let nextLane = 0;

  function walk(node: GraphSnapshot, lane: number, depth: number) {
    if (depthOf.has(node.id) && (depthOf.get(node.id) ?? 0) <= depth) {
      return;
    }
    depthOf.set(node.id, depth);
    if (!laneOf.has(node.id)) {
      laneOf.set(node.id, lane);
    }
    const kids = childrenOf(snapshots, node.id);
    kids.forEach((child, index) => {
      const childLane = index === 0 ? lane : nextLane++;
      if (index > 0) {
        laneOf.set(child.id, childLane);
      }
      walk(child, childLane, depth + 1);
    });
  }

  roots.forEach((root, index) => {
    const lane = index === 0 ? 0 : nextLane++;
    if (index === 0) {
      nextLane = Math.max(nextLane, 1);
    }
    walk(root, lane, 0);
  });

  snapshots.forEach((item) => {
    if (!laneOf.has(item.id)) {
      laneOf.set(item.id, nextLane++);
      depthOf.set(item.id, 0);
    }
  });

  const nodes: GraphNode[] = snapshots.map((item) => ({
    id: item.id,
    x: (laneOf.get(item.id) ?? 0) * X_GAP + 28,
    y: (depthOf.get(item.id) ?? 0) * Y_GAP + 28,
    branch: item.branch,
    current: item.id === activeSnapshotId,
  }));
  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  const edges: GraphEdge[] = [];
  for (const item of snapshots) {
    if (item.parentSnapshotId && nodeById.has(item.parentSnapshotId)) {
      edges.push({ from: item.parentSnapshotId, to: item.id });
    }
  }
  const labels: VersionLayout["labels"] = [];
  const seen = new Set<string>();
  for (const branch of branches) {
    const node = nodeById.get(branch.snapshotId);
    if (!node || seen.has(branch.name)) {
      continue;
    }
    seen.add(branch.name);
    labels.push({
      branch: branch.name === "main" ? "主线" : branch.name,
      x: node.x + 18,
      y: node.y - 16,
    });
  }
  return { nodes, edges, labels };
}
