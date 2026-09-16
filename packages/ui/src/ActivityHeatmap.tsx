import { buildHeatmapDays, heatLevel, monthLabels, DOW_FULL } from "./heatmap.ts";

export type ActivityHeatmapProps = {
  timestamps: string[];
  now?: Date;
  weeks?: number;
};

export function ActivityHeatmap({
  timestamps,
  now = new Date(),
  weeks = 53,
}: ActivityHeatmapProps) {
  const days = buildHeatmapDays(now, timestamps, weeks);
  const months = monthLabels(days);
  const weekCount = Math.ceil(days.length / 7);
  return (
    <div className="as-heat-card" data-testid="activity-heatmap">
      <div
        className="as-heat-months"
        style={{ gridTemplateColumns: `repeat(${weekCount}, 12px)`, gap: 3 }}
      >
        {months.map((month) => (
          <span
            key={`${month.label}-${month.week}`}
            style={{ gridColumn: month.week + 1 }}
          >
            {month.label}
          </span>
        ))}
      </div>
      <div className="as-heat-body">
        <div className="as-heat-dows">
          {DOW_FULL.map((label, index) => (
            <span key={label}>{index === 0 || index === 3 || index === 6 ? label : ""}</span>
          ))}
        </div>
        <div className="as-heat-grid" style={{ gridTemplateColumns: `repeat(${weekCount}, 12px)` }}>
          {days.map((day) => (
            <div
              key={day.iso}
              className="as-heat-cell"
              data-level={heatLevel(day.count)}
              title={`${day.iso} · ${day.count}`}
              style={{
                background: `var(--as-heat-${heatLevel(day.count)})`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="as-heat-legend">
        少
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className="as-heat-cell"
            style={{ background: `var(--as-heat-${level})` }}
          />
        ))}
        多
      </div>
    </div>
  );
}
