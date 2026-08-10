import type { ShipmentSummary } from "@gbsoft/domain";
import { EmptyState, Panel } from "../../components/ui/primitives";

/** Planlanabilir sevkiyatlar. */
export function ShipmentList({
  shipments,
  selectedId,
  loaded,
  onSelect,
}: {
  shipments: ShipmentSummary[];
  selectedId: string | null;
  /** Liste boşsa bunun "veri yok" mu "henüz yüklenmedi" mi olduğunu ayırır. */
  loaded: boolean;
  onSelect: (shipmentId: string) => void;
}) {
  return (
    <Panel title="Sevkiyatlar">
      {shipments.length === 0 && loaded ? (
        <EmptyState
          title="Sevkiyat bulunamadı"
          hint="Yükleme siparişi oluşturulduğunda burada planlanabilir."
        />
      ) : (
        <ul className="loadstudio__shipment-list">
          {shipments.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={item.id === selectedId}
                onClick={() => onSelect(item.id)}
              >
                <strong>{item.code}</strong>
                <span>
                  {item.stopCount} durak · {item.unitCount} birim
                </span>
                <span>{item.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
