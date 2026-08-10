import type {
  ShipmentDetail,
  TruckLoadPlanView,
  VehicleTemplate,
} from "@gbsoft/domain";
import { EmptyState, Note, Panel } from "../../components/ui/primitives";
import type { Message } from "./useLoadStudio";

/**
 * Sevkiyat başlığı, araç seçimi ve plan sürümü sekmeleri.
 *
 * Eski sürümler silinmez: her çözüm yeni bir sürümdür ve sekmeler arasında
 * gezinerek karşılaştırılabilir.
 */
export function PlanHeaderPanel({
  shipment,
  plans,
  plansError,
  plansLoaded,
  activePlanId,
  vehicles,
  vehicleCode,
  hasShipment,
  lockedCount,
  busy,
  message,
  onVehicleChange,
  onOptimize,
  onSelectPlan,
}: {
  shipment: ShipmentDetail | null;
  plans: TruckLoadPlanView[];
  plansError: Error | null;
  plansLoaded: boolean;
  activePlanId: string | null;
  vehicles: VehicleTemplate[];
  vehicleCode: string;
  hasShipment: boolean;
  lockedCount: number;
  busy: boolean;
  message: Message | null;
  onVehicleChange: (code: string) => void;
  onOptimize: () => void;
  onSelectPlan: (planId: string) => void;
}) {
  const selectedVehicle = vehicles.find((vehicle) => vehicle.code === vehicleCode);
  const hasPlan = plans.length > 0;

  return (
    <Panel
      title={shipment?.code ? `${shipment.code} · araç planı` : "Araç planı"}
      note={
        shipment ? (
          <span className="text-2xs muted">
            {shipment.stops.map((stop) => `${stop.seq}. ${stop.name}`).join(" → ")}
          </span>
        ) : null
      }
      action={
        hasShipment ? (
          <div className="loadstudio__plan-action">
            <label>
              <span>Araç</span>
              <select
                value={vehicleCode}
                disabled={busy}
                onChange={(event) => onVehicleChange(event.target.value)}
              >
                {vehicles.map((vehicle) => (
                  <option key={vehicle.code} value={vehicle.code}>
                    {vehicle.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || vehicles.length === 0}
              onClick={onOptimize}
            >
              {busy
                ? "Çözülüyor…"
                : lockedCount > 0
                  ? "Kilitlerle yeniden çöz"
                  : hasPlan
                    ? "Yeni sürüm üret"
                    : "Araç planı oluştur"}
            </button>
          </div>
        ) : null
      }
    >
      {message ? <Note tone={message.tone}>{message.text}</Note> : null}

      {/* Golden araç geometrisi uyarısı arayüzde kaybolmaz. */}
      {selectedVehicle?.geometrySource === "golden-assumption" ? (
        <Note tone="warning">
          Bu araç geometrisi demo varsayımıdır; üretici belgesi veya saha ölçümüyle
          onaylanmadan canlı yayın yapılamaz.
        </Note>
      ) : null}

      {plansError ? (
        <Note tone="danger">Planlar yüklenemedi. {plansError.message}</Note>
      ) : null}

      {plansLoaded && !hasPlan ? (
        <EmptyState
          title="Henüz araç planı yok"
          hint="Araç planı oluştur düğmesi durak sırasını ve güvenlik limitlerini birlikte uygular."
        />
      ) : null}

      {hasPlan ? (
        <div className="loadstudio__tabs" role="tablist" aria-label="Plan sürümleri">
          {plans.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={candidate.id === activePlanId}
              onClick={() => onSelectPlan(candidate.id)}
            >
              {index === 0 ? "Güncel" : `v${plans.length - index}`}
              <small>
                {candidate.vehicle.code} · {candidate.placements.length} birim
              </small>
            </button>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
