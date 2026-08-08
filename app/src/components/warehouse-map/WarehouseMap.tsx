import { useCallback, useMemo, useRef, useState } from "react";
import type { Location, ZoneId } from "../../domain/warehouse";
import {
  AISLE_FACES,
  CROSS_AISLE,
  FLOOR_AREAS,
  MAP,
} from "../../data/fixtures/layout";
import type { LayerId } from "./layers";
import { LAYER_BY_ID, contrastInk, rampColor } from "./layers";
import { Icon } from "../ui/Icon";

/**
 * 2B depo haritası (§8.3).
 *
 * SVG tabanlıdır; 96 lokasyonu tek geçişte çizer. Glow, particle veya
 * dekoratif animasyon içermez. Seçim outline geçişi 120 ms'dir.
 */

export type MoveArrow = {
  id: string;
  sourceId: string;
  targetId: string;
};

type Props = {
  locations: Location[];
  layer: LayerId;
  /** Görünüm modu; "diff" yalnız plana giren gözleri vurgular. */
  viewMode: "current" | "proposed" | "diff";
  zoneFilter: ZoneId | "all";
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Fare ile önizlenen lokasyon (alternatif tablosundan gelir). */
  previewId?: string | null;
  arrows: MoveArrow[];
  sourceIds: Set<string>;
  targetIds: Set<string>;
  lockedIds: Set<string>;
  excludedIds: Set<string>;
  /** Time Intelligence root-cause görünümü için vurgulanan koridorlar. */
  highlightAisles?: number[];
  height?: number;
};

const MIN_SCALE = 0.6;
const MAX_SCALE = 3;

export function WarehouseMap({
  locations,
  layer,
  viewMode,
  zoneFilter,
  selectedId,
  onSelect,
  previewId,
  arrows,
  sourceIds,
  targetIds,
  lockedIds,
  excludedIds,
  highlightAisles = [],
  height,
}: Props) {
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(
    null,
  );
  const svgRef = useRef<SVGSVGElement>(null);

  const layerDef = LAYER_BY_ID.get(layer)!;
  const locationById = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations],
  );

  const inScope = useCallback(
    (loc: Location) => zoneFilter === "all" || loc.zone === zoneFilter,
    [zoneFilter],
  );

  const inPlan = useCallback(
    (loc: Location) => sourceIds.has(loc.id) || targetIds.has(loc.id),
    [sourceIds, targetIds],
  );

  function fillFor(loc: Location): string {
    if (layer === "planChange" || viewMode === "diff") {
      if (excludedIds.has(loc.id)) return "var(--surface-2)";
      if (targetIds.has(loc.id)) return "var(--teal-100)";
      if (sourceIds.has(loc.id)) return "var(--blue-100)";
      return "var(--surface-1)";
    }
    return rampColor(layerDef, layerDef.value(loc));
  }

  function opacityFor(loc: Location): number {
    if (!inScope(loc)) return 0.22;
    if (viewMode === "diff" && !inPlan(loc)) return 0.25;
    return 1;
  }

  /* --- zoom / pan --- */

  function zoomBy(factor: number) {
    setView((v) => ({
      ...v,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor)),
    }));
  }

  function fitToView() {
    setView({ x: 0, y: 0, scale: 1 });
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      vx: view.x,
      vy: view.y,
    };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const unitPerPx = MAP.width / rect.width;
    setView((v) => ({
      ...v,
      x: drag.vx + ((event.clientX - drag.x) * unitPerPx) / v.scale,
      y: drag.vy + ((event.clientY - drag.y) * unitPerPx) / v.scale,
    }));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  /* --- klavye ile lokasyon seçimi --- */

  function moveSelection(direction: "left" | "right" | "up" | "down") {
    const visible = locations.filter(inScope);
    if (visible.length === 0) return;
    const current = selectedId ? locationById.get(selectedId) : undefined;
    if (!current) {
      onSelect(visible[0].id);
      return;
    }
    const cx = current.x + current.width / 2;
    const cy = current.y + current.height / 2;

    const candidates = visible.filter((l) => {
      const lx = l.x + l.width / 2;
      const ly = l.y + l.height / 2;
      if (direction === "left") return lx < cx - 1;
      if (direction === "right") return lx > cx + 1;
      if (direction === "up") return ly < cy - 1;
      return ly > cy + 1;
    });
    if (candidates.length === 0) return;

    const nearest = candidates.reduce((best, l) => {
      const d = (a: Location) =>
        Math.abs(a.x + a.width / 2 - cx) * (direction === "up" || direction === "down" ? 3 : 1) +
        Math.abs(a.y + a.height / 2 - cy) *
          (direction === "left" || direction === "right" ? 3 : 1);
      return d(l) < d(best) ? l : best;
    });
    onSelect(nearest.id);
  }

  function onKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    const map: Record<string, "left" | "right" | "up" | "down"> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    };
    const dir = map[event.key];
    if (dir) {
      event.preventDefault();
      moveSelection(dir);
    } else if (event.key === "Escape") {
      onSelect(null);
    }
  }

  const viewBox = `${-view.x} ${-view.y} ${MAP.width / view.scale} ${
    MAP.height / view.scale
  }`;

  return (
    <div className="map">
      <div className="map__toolbar">
        <div className="map__legend">
          <span className="text-2xs subtle">{layerDef.legendLow}</span>
          <span className="map__ramp" data-layer={layer} aria-hidden="true">
            {layer === "planChange" || viewMode === "diff" ? (
              <>
                <i style={{ background: "var(--blue-100)" }} />
                <i style={{ background: "var(--teal-100)" }} />
              </>
            ) : (
              Array.from({ length: 6 }, (_, i) => (
                <i
                  key={i}
                  style={{
                    background: rampColor(
                      layerDef,
                      layerDef.min +
                        ((layerDef.max - layerDef.min) * i) / 5,
                    ),
                  }}
                />
              ))
            )}
          </span>
          <span className="text-2xs subtle">{layerDef.legendHigh}</span>
        </div>
        <div className="map__zoom">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => zoomBy(1 / 1.25)}
            aria-label="Uzaklaştır"
          >
            <Icon name="zoomOut" size={14} />
          </button>
          <span className="mono text-2xs" style={{ minWidth: 38, textAlign: "center" }}>
            {Math.round(view.scale * 100)}%
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => zoomBy(1.25)}
            aria-label="Yakınlaştır"
          >
            <Icon name="zoomIn" size={14} />
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={fitToView}
            aria-label="Görünüme sığdır"
          >
            <Icon name="fit" size={14} />
            <span className="text-2xs">Sığdır</span>
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        className="map__canvas"
        viewBox={viewBox}
        style={height ? { height } : undefined}
        role="application"
        aria-label="Depo yerleşim haritası. Ok tuşlarıyla lokasyon seçin, Escape ile seçimi kaldırın."
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <defs>
          <pattern
            id="hatch-blocked"
            width="6"
            height="6"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="6" height="6" fill="var(--red-100)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="var(--red-700)"
              strokeWidth="1.6"
            />
          </pattern>
          <marker
            id="move-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 z" fill="var(--teal-700)" />
          </marker>
        </defs>

        {/* Zemin */}
        <rect
          x={0}
          y={0}
          width={MAP.width}
          height={MAP.height}
          fill="var(--surface-1)"
        />

        {/* Cross-aisle */}
        <rect
          x={MAP.originX - 12}
          y={CROSS_AISLE.y}
          width={MAP.aislePitch * 12}
          height={CROSS_AISLE.height}
          fill="var(--surface-2)"
        />
        <text
          x={MAP.originX - 6}
          y={CROSS_AISLE.y + CROSS_AISLE.height / 2 + 3}
          fontSize="8"
          fill="var(--ink-500)"
        >
          cross-aisle
        </text>

        {/* Koridor başlıkları ve vurgular */}
        {AISLE_FACES.map((face) => {
          const x = MAP.originX + (face.aisle - 1) * MAP.aislePitch;
          const highlighted = highlightAisles.includes(face.aisle);
          return (
            <g key={face.aisle}>
              {highlighted ? (
                <rect
                  x={x - 3}
                  y={34}
                  width={MAP.aislePitch - 4}
                  height={300}
                  fill="var(--red-100)"
                  stroke="var(--red-700)"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
              ) : null}
              <text
                x={x + MAP.aislePitch / 2 - 4}
                y={28}
                textAnchor="middle"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill={highlighted ? "var(--red-700)" : "var(--ink-600)"}
                fontWeight={highlighted ? 600 : 400}
              >
                {String(face.aisle).padStart(2, "0")}
              </text>
            </g>
          );
        })}

        {/* Lokasyonlar */}
        {locations.map((loc) => {
          const selected = loc.id === selectedId;
          const preview = loc.id === previewId;
          const isTarget = targetIds.has(loc.id);
          const isSource = sourceIds.has(loc.id);
          const locked = lockedIds.has(loc.id);
          const excluded = excludedIds.has(loc.id);
          const value = layerDef.value(loc);

          return (
            <g
              key={loc.id}
              opacity={opacityFor(loc)}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(selected ? null : loc.id);
              }}
              style={{ cursor: "pointer" }}
              data-testid={`location-${loc.id}`}
            >
              <title>
                {`${loc.id} · ${layerDef.label} ${
                  layer === "congestion"
                    ? value.toFixed(2)
                    : Math.round(value)
                } ${layerDef.unit}`}
              </title>
              <rect
                x={loc.x}
                y={loc.y}
                width={loc.width}
                height={loc.height}
                rx={2}
                fill={loc.blocked ? "url(#hatch-blocked)" : fillFor(loc)}
                stroke={
                  selected
                    ? "var(--ink-950)"
                    : preview
                      ? "var(--blue-700)"
                      : "var(--line-strong)"
                }
                strokeWidth={selected ? 2 : preview ? 1.6 : 0.7}
                style={{
                  transition: "stroke var(--dur-fast) var(--ease)",
                }}
              />
              {isTarget && !selected ? (
                <rect
                  x={loc.x + 1.5}
                  y={loc.y + 1.5}
                  width={loc.width - 3}
                  height={loc.height - 3}
                  rx={1.5}
                  fill="none"
                  stroke="var(--teal-700)"
                  strokeWidth={1.6}
                  strokeDasharray="4 3"
                />
              ) : null}
              {isSource && !isTarget && !selected ? (
                <rect
                  x={loc.x + 1.5}
                  y={loc.y + 1.5}
                  width={loc.width - 3}
                  height={loc.height - 3}
                  rx={1.5}
                  fill="none"
                  stroke="var(--blue-700)"
                  strokeWidth={1.2}
                />
              ) : null}
              {excluded ? (
                <line
                  x1={loc.x + 4}
                  y1={loc.y + 4}
                  x2={loc.x + loc.width - 4}
                  y2={loc.y + loc.height - 4}
                  stroke="var(--ink-600)"
                  strokeWidth={1.4}
                />
              ) : null}
              {locked ? (
                <g transform={`translate(${loc.x + loc.width / 2 - 5} ${loc.y + 5})`}>
                  <rect
                    width={10}
                    height={7}
                    y={3}
                    rx={1}
                    fill="var(--ink-950)"
                  />
                  <path
                    d="M2.5 3.5V2.2a2.5 2.5 0 0 1 5 0v1.3"
                    fill="none"
                    stroke="var(--ink-950)"
                    strokeWidth={1.3}
                  />
                </g>
              ) : null}
              {view.scale >= 1.6 ? (
                <text
                  x={loc.x + loc.width / 2}
                  y={loc.y + loc.height / 2 + 3}
                  textAnchor="middle"
                  fontSize="7"
                  fontFamily="var(--font-mono)"
                  fill={
                    layer === "planChange" || viewMode === "diff"
                      ? "var(--ink-700)"
                      : contrastInk(layerDef, value)
                  }
                  pointerEvents="none"
                >
                  {loc.bay}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Kaynak → hedef okları */}
        {arrows.map((arrow) => {
          const from = locationById.get(arrow.sourceId);
          const to = locationById.get(arrow.targetId);
          if (!from || !to) return null;
          const x1 = from.x + from.width / 2;
          const y1 = from.y + from.height / 2;
          const x2 = to.x + to.width / 2;
          const y2 = to.y + to.height / 2;
          const midY = Math.min(y1, y2) - 18;
          return (
            <path
              key={arrow.id}
              d={`M${x1} ${y1} Q ${(x1 + x2) / 2} ${midY} ${x2} ${y2}`}
              fill="none"
              stroke="var(--teal-700)"
              // Çok sayıda ok aynı anda çizildiğinde harita okunur kalsın.
              strokeWidth={arrows.length > 3 ? 0.9 : 1.5}
              markerEnd="url(#move-arrow)"
              opacity={arrows.length > 3 ? 0.4 : 0.9}
            />
          );
        })}

        {/* Dock / staging / packing */}
        {FLOOR_AREAS.map((area) => (
          <g key={area.id}>
            <rect
              x={area.x}
              y={area.y}
              width={area.width}
              height={area.height}
              fill="var(--surface-2)"
              stroke="var(--line-strong)"
              strokeWidth={0.8}
              strokeDasharray={area.id === "dock" ? undefined : "5 4"}
            />
            <text
              x={area.x + 8}
              y={area.y + 18}
              fontSize="10"
              fill="var(--ink-600)"
              fontWeight={500}
            >
              {area.label}
            </text>
          </g>
        ))}

        {/* Ana giriş/çıkış yönü */}
        <g>
          <path
            d={`M${MAP.dockX - 40} ${MAP.dockY + 52} L${MAP.dockX - 40} ${
              MAP.dockY + 68
            } L${MAP.dockX + 40} ${MAP.dockY + 68}`}
            fill="none"
            stroke="var(--ink-500)"
            strokeWidth={1.2}
            markerEnd="url(#move-arrow)"
          />
          <text
            x={MAP.dockX + 50}
            y={MAP.dockY + 72}
            fontSize="9"
            fill="var(--ink-600)"
          >
            sevkiyat yönü
          </text>
        </g>
      </svg>
    </div>
  );
}
