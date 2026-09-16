import {
  layoutVersionGraph,
  type GraphBranch,
  type GraphSnapshot,
} from "./version-graph.ts";

export type VersionGraphProps = {
  snapshots: GraphSnapshot[];
  branches: GraphBranch[];
  activeSnapshotId?: string;
  onSelect?: (snapshotId: string) => void;
};

export function VersionGraph({
  snapshots,
  branches,
  activeSnapshotId,
  onSelect,
}: VersionGraphProps) {
  const layout = layoutVersionGraph(snapshots, branches, activeSnapshotId);
  const width = Math.max(
    280,
    ...layout.nodes.map((node) => node.x + 80),
    280,
  );
  const height = Math.max(
    240,
    ...layout.nodes.map((node) => node.y + 48),
    240,
  );
  const pos = new Map(layout.nodes.map((node) => [node.id, node]));
  return (
    <div className="as-graph" data-testid="version-graph">
      {layout.nodes.length === 0 ? (
        <p className="as-preview-ver">选择画稿后显示版本图</p>
      ) : (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {layout.edges.map((edge) => {
            const from = pos.get(edge.from);
            const to = pos.get(edge.to);
            if (!from || !to) {
              return null;
            }
            const midY = (from.y + to.y) / 2;
            const d =
              from.x === to.x
                ? `M ${from.x} ${from.y + 10} L ${to.x} ${to.y - 10}`
                : `M ${from.x} ${from.y + 10} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - 10}`;
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <path d={d} fill="none" stroke="#3b82f6" strokeWidth={2} />
                <polygon
                  points={`${to.x},${to.y - 10} ${to.x - 4},${to.y - 18} ${to.x + 4},${to.y - 18}`}
                  fill="#3b82f6"
                />
              </g>
            );
          })}
          {layout.labels.map((label) => (
            <text
              key={label.branch}
              x={label.x}
              y={label.y}
              fill="#9a9a9a"
              fontSize={12}
            >
              {label.branch}
            </text>
          ))}
          {layout.nodes.map((node) => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => onSelect?.(node.id)}
              style={{ cursor: onSelect ? "pointer" : "default" }}
            >
              <circle r={11} fill="#3b82f6" />
              {node.current ? (
                <circle r={15} fill="none" stroke="#f59e0b" strokeWidth={3} />
              ) : null}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
