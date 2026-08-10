import { Suspense, lazy, useMemo } from "react";
import type { TruckLoadPlanView } from "@gbsoft/domain";
import { StatusTag } from "../../components/ui/primitives";
import { TruckLoadFootprint2D } from "./TruckLoadFootprint2D";
import { colorForStop } from "./loadColors";
import { STATE_LABEL } from "./labels";

const TruckLoadScene3D = lazy(() =>
  import("../../components/truck-load-3d/TruckLoadScene3D").then((module) => ({
    default: module.TruckLoadScene3D,
  })),
);

/**
 * Araç yerleşiminin görsel alanı: başlık, durak lejandı, 3B sahne ve
 * yükleme sırası replay'i.
 *
 * WebGL yoksa aynı yerleşim 2B üst görünümle okunur; seçim ve replay
 * davranışı iki görünümde de aynıdır.
 */
export function LoadViewer({
  plan,
  webglSupported,
  selectedHuCode,
  visibleThroughSeq,
  maxSeq,
  playing,
  sectionView,
  onSelect,
  onToggleSection,
  onTogglePlay,
  onSeek,
}: {
  plan: TruckLoadPlanView;
  webglSupported: boolean;
  selectedHuCode: string | null;
  visibleThroughSeq: number;
  maxSeq: number;
  playing: boolean;
  sectionView: boolean;
  onSelect: (huCode: string | null) => void;
  onToggleSection: () => void;
  onTogglePlay: () => void;
  onSeek: (seq: number) => void;
}) {
  const uniqueStops = useMemo(
    () =>
      [
        ...new Map(
          plan.placements.map((placement) => [placement.stopSeq, placement.stopCode]),
        ).entries(),
      ].sort(([a], [b]) => a - b),
    [plan.placements],
  );

  const visibleCount = plan.placements.filter(
    (placement) => placement.seq <= visibleThroughSeq,
  ).length;

  return (
    <section className="loadstudio__viewer" aria-label="Araç yükleme görünümü">
      <div className="loadstudio__viewer-head">
        <div>
          <strong>{plan.vehicle.name}</strong>
          <span>
            {plan.vehicle.internalLengthM} × {plan.vehicle.internalWidthM} ×{" "}
            {plan.vehicle.internalHeightM} m · arka kapı sağda
          </span>
        </div>
        <div className="loadstudio__viewer-actions">
          <button
            type="button"
            className="btn"
            aria-pressed={sectionView}
            onClick={onToggleSection}
          >
            {sectionView ? "Kesit açık" : "Kesit kapalı"}
          </button>
          <StatusTag status={STATE_LABEL[plan.state]} />
        </div>
      </div>

      <div className="loadstudio__legend">
        {uniqueStops.map(([seq, code]) => (
          <span key={seq}>
            <i style={{ background: colorForStop(seq) }} />
            {seq}. {code}
          </span>
        ))}
        <span>
          <i className="loadstudio__cog-dot" />
          Ağırlık merkezi
        </span>
      </div>

      <div className="loadstudio__stage">
        {webglSupported ? (
          <Suspense
            fallback={<div className="loadstudio__loading">3B araç hazırlanıyor…</div>}
          >
            <TruckLoadScene3D
              plan={plan}
              selectedHuCode={selectedHuCode}
              visibleThroughSeq={visibleThroughSeq}
              sectionView={sectionView}
              onSelect={onSelect}
            />
          </Suspense>
        ) : (
          <TruckLoadFootprint2D
            plan={plan}
            selectedHuCode={selectedHuCode}
            visibleThroughSeq={visibleThroughSeq}
            onSelect={onSelect}
          />
        )}
      </div>

      <div className="loadstudio__replay">
        <button type="button" className="btn" onClick={onTogglePlay}>
          {playing ? "Duraklat" : visibleThroughSeq >= maxSeq ? "Baştan oynat" : "Oynat"}
        </button>
        <input
          aria-label="Yükleme sırası"
          type="range"
          min={0}
          max={maxSeq}
          value={visibleThroughSeq}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <span className="mono text-xs">
          {visibleCount}/{plan.placements.length}
        </span>
      </div>
    </section>
  );
}
