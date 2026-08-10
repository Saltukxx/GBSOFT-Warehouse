import type { PalletPlanView } from "@gbsoft/domain";

/** WebGL olmayan cihazlarda aynı planın tepeden, düzenlenebilir görünümü. */
export function PalletFootprint2D({
  plan,
  selectedHuCode,
  visibleThroughSeq,
  onSelect,
}: {
  plan: PalletPlanView;
  selectedHuCode: string | null;
  visibleThroughSeq: number;
  onSelect: (huCode: string | null) => void;
}) {
  return (
    <div
      className="palletstudio__fallback"
      style={{ aspectRatio: `${plan.base.lengthM} / ${plan.base.widthM}` }}
      onClick={() => onSelect(null)}
      role="group"
      aria-label="Palet tepeden görünümü"
    >
      {plan.placements
        .filter((placement) => placement.seq <= visibleThroughSeq)
        .sort((a, b) => a.y - b.y)
        .map((placement) => (
          <button
            key={placement.huCode}
            type="button"
            className="palletstudio__fallback-box"
            aria-pressed={placement.huCode === selectedHuCode}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(placement.huCode);
            }}
            style={{
              left: `${(placement.x / plan.base.lengthM) * 100}%`,
              top: `${(placement.z / plan.base.widthM) * 100}%`,
              width: `${(placement.lengthM / plan.base.lengthM) * 100}%`,
              height: `${(placement.widthM / plan.base.widthM) * 100}%`,
              zIndex: Math.round(placement.y * 100) + 1,
            }}
            title={`${placement.huCode} · sıra ${placement.seq}`}
          >
            {placement.seq}
          </button>
        ))}
    </div>
  );
}
