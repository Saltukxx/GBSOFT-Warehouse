import type { TruckLoadPlanView } from "@gbsoft/domain";
import { colorForStop } from "./loadColors";

export function TruckLoadFootprint2D({
  plan,
  selectedHuCode,
  visibleThroughSeq,
  onSelect,
}: {
  plan: TruckLoadPlanView;
  selectedHuCode: string | null;
  visibleThroughSeq: number;
  onSelect: (huCode: string | null) => void;
}) {
  const { internalLengthM: length, internalWidthM: width } = plan.vehicle;
  return (
    <div className="loadstudio__fallback-wrap">
      <div
        className="loadstudio__fallback"
        style={{ aspectRatio: `${length} / ${width}` }}
        onClick={() => onSelect(null)}
        role="presentation"
      >
        {plan.vehicle.obstacles.map((obstacle) => (
          <span
            key={obstacle.code}
            className="loadstudio__fallback-obstacle"
            title={obstacle.label}
            style={{
              left: `${(obstacle.x / length) * 100}%`,
              top: `${(obstacle.y / width) * 100}%`,
              width: `${(obstacle.lengthM / length) * 100}%`,
              height: `${(obstacle.widthM / width) * 100}%`,
            }}
          />
        ))}
        {plan.placements
          .filter((placement) => placement.seq <= visibleThroughSeq)
          .map((placement) => (
            <button
              key={placement.unitCode}
              type="button"
              className="loadstudio__fallback-box"
              aria-pressed={placement.unitCode === selectedHuCode}
              title={`${placement.seq}. ${placement.unitCode} · ${placement.stopCode}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(placement.unitCode);
              }}
              style={{
                left: `${(placement.x / length) * 100}%`,
                top: `${(placement.y / width) * 100}%`,
                width: `${(placement.lengthM / length) * 100}%`,
                height: `${(placement.widthM / width) * 100}%`,
                background: colorForStop(placement.stopSeq),
              }}
            >
              {placement.seq}
            </button>
          ))}
        <span className="loadstudio__door-label">ARKA KAPI</span>
      </div>
    </div>
  );
}
