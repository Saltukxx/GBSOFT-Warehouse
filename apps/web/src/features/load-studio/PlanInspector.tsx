import type {
  AxleLoadKind,
  TruckLoadPlanView,
  WeightDistributionReport,
} from "@gbsoft/domain";
import { EmptyState, Panel, StatusTag } from "../../components/ui/primitives";
import { Icon } from "../../components/ui/Icon";
import { AXLE_KIND_LABEL } from "./labels";

export type CoordinateDraft = { x: string; y: string; z: string };

type Placement = TruckLoadPlanView["placements"][number];

function formatShare(
  value: number | null,
  minimum: number | null,
): string | null {
  if (value === null) return null;
  if (minimum === null) return `%${value.toFixed(1)}`;
  return `%${value.toFixed(1)} / asgari %${minimum.toFixed(0)}`;
}

function DistributionFacts({ report }: { report: WeightDistributionReport }) {
  const rows: Array<{ label: string; value: string }> = [
    {
      label: "Katar",
      value:
        report.maxCombinationKg === null
          ? `${report.combinationKg.toFixed(0)} kg`
          : `${report.combinationKg.toFixed(0)} / ${report.maxCombinationKg.toFixed(0)} kg`,
    },
  ];
  if (report.couplingLoadKg !== null) {
    rows.push({
      label: "Kaplin",
      value:
        report.couplingCapacityKg === null
          ? `${report.couplingLoadKg.toFixed(0)} kg`
          : `${report.couplingLoadKg.toFixed(0)} / ${report.couplingCapacityKg.toFixed(0)} kg`,
    });
  }
  const drive = formatShare(report.driveAxleSharePct, report.minDriveAxleSharePct);
  if (drive) rows.push({ label: "Tahrik payı", value: drive });
  const steer = formatShare(report.steerAxleSharePct, report.minSteerAxleSharePct);
  if (steer) rows.push({ label: "Direksiyon payı", value: steer });

  return (
    <dl className="loadstudio__facts loadstudio__distribution">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Aks yükleri, katar dağılımı ve ağırlık merkezi. */
export function AxleBalancePanel({ plan }: { plan: TruckLoadPlanView }) {
  return (
    <Panel title="Aks ve denge" note={<span className="text-2xs muted">Kırmızı nokta: CoG</span>}>
      <div className="loadstudio__cog">
        x {plan.centerOfGravity.x.toFixed(2)} · y {plan.centerOfGravity.y.toFixed(2)} · z{" "}
        {plan.centerOfGravity.z.toFixed(2)} m
      </div>
      <DistributionFacts report={plan.weightDistribution} />
      <div className="loadstudio__axles">
        {plan.axleLoads.map((axle) => {
          const kind = (axle.kind ?? "trailer-axle") as AxleLoadKind;
          const over = axle.utilizationPct > 100;
          return (
            <div
              key={axle.code}
              data-kind={kind}
              data-over={over ? "true" : undefined}
            >
              <span>
                <strong>{axle.code}</strong>
                <small>
                  {AXLE_KIND_LABEL[kind]} · {axle.totalLoadKg.toFixed(0)} /{" "}
                  {axle.maxLoadKg.toFixed(0)} kg
                </small>
              </span>
              <div className="loadstudio__bar">
                {/* Dolgu %100'de kırpılır: sınırı aşan yük çubuğu taşırmaz,
                    ihlali doğrulama listesi bildirir. */}
                <i style={{ width: `${Math.min(100, axle.utilizationPct)}%` }} />
              </div>
              <em>%{axle.utilizationPct.toFixed(1)}</em>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/**
 * Seçili birimin taşıma/döndürme/kilitleme editörü.
 *
 * Yayınlanmış plan düzenlenemez: `published` bir plan yürütmeye girmiştir ve
 * sahadaki yerleşimle uyumsuz hâle gelmemelidir.
 */
export function PlacementEditor({
  plan,
  placement,
  draft,
  busy,
  onDraftChange,
  onSavePosition,
  onRotate,
  onToggleLock,
}: {
  plan: TruckLoadPlanView;
  placement: Placement | null;
  draft: CoordinateDraft;
  busy: boolean;
  onDraftChange: (draft: CoordinateDraft) => void;
  onSavePosition: () => void;
  onRotate: () => void;
  onToggleLock: () => void;
}) {
  if (!placement) {
    return (
      <Panel title="Yerleşim editörü">
        <EmptyState
          title="Bir yük seçin"
          hint="3B araçta veya yükleme sırasında bir birime tıklayın."
        />
      </Panel>
    );
  }

  const locked = plan.state === "published" || busy;

  return (
    <Panel title="Yerleşim editörü">
      <div className="loadstudio__editor-body">
        <div className="loadstudio__selected">
          <div>
            <strong>{placement.unitCode}</strong>
            <span>{placement.skuCode ?? "Elleçleme birimi"}</span>
          </div>
          {placement.locked ? <StatusTag status="Kilitli" /> : null}
        </div>

        <dl className="loadstudio__facts">
          <div>
            <dt>Durak</dt>
            <dd>
              {placement.stopSeq}. {placement.stopCode}
            </dd>
          </div>
          <div>
            <dt>Yükleme sırası</dt>
            <dd>{placement.seq}</dd>
          </div>
          <div>
            <dt>Ölçü</dt>
            <dd>
              {placement.lengthM} × {placement.widthM} × {placement.heightM} m
            </dd>
          </div>
          <div>
            <dt>Ağırlık</dt>
            <dd>{placement.grossWeightKg.toFixed(1)} kg</dd>
          </div>
        </dl>

        <fieldset className="loadstudio__coordinates" disabled={locked}>
          <legend>Sol-ön-alt koordinat (m)</legend>
          {(["x", "y", "z"] as const).map((axis) => (
            <label key={axis}>
              <span>{axis.toUpperCase()}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={draft[axis]}
                onChange={(event) =>
                  onDraftChange({ ...draft, [axis]: event.target.value })
                }
              />
            </label>
          ))}
        </fieldset>

        <div className="loadstudio__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={locked}
            onClick={onSavePosition}
          >
            Konumu uygula
          </button>
          <button type="button" className="btn" disabled={locked} onClick={onRotate}>
            90° döndür
          </button>
          <button type="button" className="btn" disabled={locked} onClick={onToggleLock}>
            <Icon name={placement.locked ? "unlock" : "lock"} size={14} />
            {placement.locked ? "Kilidi kaldır" : "Yerini kilitle"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

/** Fiziksel yükleme sırası; 1 ilk araca giren birimdir. */
export function LoadSequenceList({
  plan,
  selectedHuCode,
  onSelect,
}: {
  plan: TruckLoadPlanView;
  selectedHuCode: string | null;
  onSelect: (placement: Placement) => void;
}) {
  const ordered = [...plan.placements].sort((a, b) => a.seq - b.seq);

  return (
    <Panel
      title="Yükleme sırası"
      note={<span className="text-2xs muted">Son durak önce</span>}
    >
      <ol className="loadstudio__sequence">
        {ordered.map((placement) => (
          <li key={placement.unitCode}>
            <button
              type="button"
              aria-current={placement.unitCode === selectedHuCode}
              onClick={() => onSelect(placement)}
            >
              <span>{placement.seq}</span>
              <strong>{placement.unitCode}</strong>
              <small>
                {placement.stopSeq}. {placement.stopCode}
                {placement.locked ? " · kilitli" : ""}
              </small>
            </button>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
