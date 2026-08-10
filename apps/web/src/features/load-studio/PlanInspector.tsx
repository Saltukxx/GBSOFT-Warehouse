import type { TruckLoadPlanView } from "@gbsoft/domain";
import { EmptyState, Panel, StatusTag } from "../../components/ui/primitives";
import { Icon } from "../../components/ui/Icon";

export type CoordinateDraft = { x: string; y: string; z: string };

type Placement = TruckLoadPlanView["placements"][number];

/** Aks yükleri ve ağırlık merkezi. */
export function AxleBalancePanel({ plan }: { plan: TruckLoadPlanView }) {
  return (
    <Panel title="Aks ve denge" note={<span className="text-2xs muted">Kırmızı nokta: CoG</span>}>
      <div className="loadstudio__cog">
        x {plan.centerOfGravity.x.toFixed(2)} · y {plan.centerOfGravity.y.toFixed(2)} · z{" "}
        {plan.centerOfGravity.z.toFixed(2)} m
      </div>
      <div className="loadstudio__axles">
        {plan.axleLoads.map((axle) => (
          <div key={axle.code}>
            <span>
              <strong>{axle.code}</strong>
              <small>
                {axle.totalLoadKg.toFixed(0)} / {axle.maxLoadKg.toFixed(0)} kg
              </small>
            </span>
            <div className="loadstudio__bar">
              {/* Dolgu %100'de kırpılır: sınırı aşan yük çubuğu taşırmaz,
                  ihlali doğrulama listesi bildirir. */}
              <i style={{ width: `${Math.min(100, axle.utilizationPct)}%` }} />
            </div>
            <em>%{axle.utilizationPct.toFixed(1)}</em>
          </div>
        ))}
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
