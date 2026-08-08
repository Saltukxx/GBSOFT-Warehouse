import { useId, useState } from "react";
import type { CompletionPoint } from "../../data/fixtures/overview";
import { num } from "../../lib/format";

/**
 * Picking tamamlanma tahmini (§6.4).
 * Gerçekleşen lacivert, P50 mor kesikli, P90 açık mor bant,
 * SLA cut-off kırmızı ince dikey çizgi. Dekoratif area chart yok.
 */

type Props = {
  data: CompletionPoint[];
  nowHour: number;
  slaHour: number;
  slaTarget: number;
  height?: number;
};

const PAD = { top: 16, right: 18, bottom: 30, left: 52 };

export function CompletionChart({
  data,
  nowHour,
  slaHour,
  slaTarget,
  height = 232,
}: Props) {
  const [hover, setHover] = useState<CompletionPoint | null>(null);
  const titleId = useId();
  const width = 640;

  const minHour = data[0].hour;
  const maxHour = data[data.length - 1].hour;
  const maxY = 3200;

  const x = (hour: number) =>
    PAD.left +
    ((hour - minHour) / (maxHour - minHour)) * (width - PAD.left - PAD.right);
  const y = (value: number) =>
    height - PAD.bottom - (value / maxY) * (height - PAD.top - PAD.bottom);

  const line = (points: Array<[number, number]>) =>
    points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px} ${py}`).join(" ");

  const actualPoints = data
    .filter((d) => d.actual !== null)
    .map((d) => [x(d.hour), y(d.actual as number)] as [number, number]);

  const p50Points = data.map(
    (d) => [x(d.hour), y(d.p50)] as [number, number],
  );

  const bandTop = data.map((d) => `${x(d.hour)} ${y(d.p90High)}`).join(" L");
  const bandBottom = data
    .slice()
    .reverse()
    .map((d) => `${x(d.hour)} ${y(d.p90Low)}`)
    .join(" L");

  const yTicks = [0, 800, 1600, 2400, 3200];

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-labelledby={titleId}
        style={{ display: "block" }}
        onMouseLeave={() => setHover(null)}
      >
        <title id={titleId}>
          Saat bazında tamamlanan order line; gerçekleşen, P50 tahmini ve P90
          aralığı
        </title>

        {/* Y ekseni ızgarası */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--surface-3)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--ink-500)"
              fontFamily="var(--font-mono)"
            >
              {num(tick)}
            </text>
          </g>
        ))}

        {/* X ekseni */}
        {data
          .filter((_, i) => i % 2 === 0)
          .map((d) => (
            <text
              key={d.hour}
              x={x(d.hour)}
              y={height - PAD.bottom + 15}
              textAnchor="middle"
              fontSize="10"
              fill="var(--ink-500)"
              fontFamily="var(--font-mono)"
            >
              {d.label}
            </text>
          ))}

        {/* P90 bandı */}
        <path
          d={`M${bandTop} L${bandBottom} Z`}
          fill="var(--purple-200)"
          opacity={0.55}
        />

        {/* P50 */}
        <path
          d={line(p50Points)}
          fill="none"
          stroke="var(--purple-700)"
          strokeWidth={1.6}
          strokeDasharray="5 4"
        />

        {/* Gerçekleşen */}
        <path
          d={line(actualPoints)}
          fill="none"
          stroke="var(--ink-950)"
          strokeWidth={2}
        />

        {/* Şu an */}
        <line
          x1={x(nowHour)}
          x2={x(nowHour)}
          y1={PAD.top}
          y2={height - PAD.bottom}
          stroke="var(--ink-500)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <text
          x={x(nowHour) + 5}
          y={PAD.top + 9}
          fontSize="10"
          fill="var(--ink-600)"
        >
          14:32 · veri kesme
        </text>

        {/* SLA cut-off */}
        <line
          x1={x(slaHour)}
          x2={x(slaHour)}
          y1={PAD.top}
          y2={height - PAD.bottom}
          stroke="var(--red-700)"
          strokeWidth={1}
        />
        <text
          x={x(slaHour) - 5}
          y={PAD.top + 9}
          fontSize="10"
          fill="var(--red-700)"
          textAnchor="end"
        >
          SLA 18:00
        </text>
        <circle cx={x(slaHour)} cy={y(slaTarget)} r={3} fill="var(--red-700)" />

        {/* Hover hedefleri */}
        {data.map((d) => (
          <rect
            key={d.hour}
            x={x(d.hour) - 18}
            y={PAD.top}
            width={36}
            height={height - PAD.top - PAD.bottom}
            fill="transparent"
            onMouseEnter={() => setHover(d)}
          />
        ))}
        {hover ? (
          <circle
            cx={x(hover.hour)}
            cy={y(hover.actual ?? hover.p50)}
            r={3.5}
            fill="var(--surface-0)"
            stroke="var(--ink-950)"
            strokeWidth={1.6}
          />
        ) : null}

        {/* Eksen çizgileri */}
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={height - PAD.bottom}
          y2={height - PAD.bottom}
          stroke="var(--line-strong)"
        />
      </svg>

      <figcaption
        className="text-xs muted"
        style={{
          display: "flex",
          gap: "var(--space-4)",
          flexWrap: "wrap",
          padding: "var(--space-2) 0 0",
          borderTop: "1px solid var(--surface-2)",
          marginTop: 4,
        }}
      >
        <LegendItem color="var(--ink-950)" label="Gerçekleşen" />
        <LegendItem color="var(--purple-700)" label="P50 tahmini" dashed />
        <LegendItem color="var(--purple-200)" label="P90 aralığı" solid />
        <LegendItem color="var(--red-700)" label="SLA cut-off" />
        <span style={{ marginLeft: "auto" }}>
          {hover
            ? `${hover.label} · gerçekleşen ${
                hover.actual === null ? "-" : num(hover.actual)
              } · P50 ${num(hover.p50)} · P90 ${num(hover.p90Low)}-${num(
                hover.p90High,
              )} line`
            : "Y ekseni: tamamlanmış order line · sıfırdan başlar"}
        </span>
      </figcaption>
    </figure>
  );
}

function LegendItem({
  color,
  label,
  dashed,
  solid,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  solid?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <svg width={16} height={8} aria-hidden="true">
        {solid ? (
          <rect width={16} height={8} fill={color} />
        ) : (
          <line
            x1={0}
            x2={16}
            y1={4}
            y2={4}
            stroke={color}
            strokeWidth={2}
            strokeDasharray={dashed ? "4 3" : undefined}
          />
        )}
      </svg>
      {label}
    </span>
  );
}
