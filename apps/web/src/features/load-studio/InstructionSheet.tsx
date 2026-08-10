import type { LoadInstructionSheet } from "@gbsoft/domain";
import { Note, Panel } from "../../components/ui/primitives";

/**
 * Mobil ve yazdırılabilir yükleme talimatı.
 *
 * Başlıktaki "SHADOW / SİMÜLASYON" damgası kâğıda da basılır: elinde çıktıyla
 * sahaya inen kişi bunun canlı bir WMS görevi olmadığını görmelidir.
 */
export function InstructionSheetPanel({
  sheet,
  error,
}: {
  sheet: LoadInstructionSheet | null;
  error: Error | null;
}) {
  return (
    <Panel
      title="Yükleme talimatı"
      note={<span className="text-2xs muted">Mobil ve yazdırılabilir</span>}
      action={
        <button
          type="button"
          className="btn"
          disabled={!sheet}
          onClick={() => window.print()}
        >
          Yazdır
        </button>
      }
    >
      {sheet ? (
        <div className="loadstudio__instruction-sheet">
          <div className="loadstudio__instruction-head">
            <strong>{sheet.planCode}</strong>
            <span>
              {sheet.shipmentCode} · {sheet.vehicleName}
            </span>
            <em>SHADOW / SİMÜLASYON</em>
          </div>
          <ol>
            {sheet.steps.map((step) => (
              <li key={step.unitCode}>
                <span>{step.seq}</span>
                <div>
                  <strong>{step.unitCode}</strong>
                  <small>
                    {step.stopSeq}. {step.stopCode} · x {step.position.x.toFixed(2)} / y{" "}
                    {step.position.y.toFixed(2)} / z {step.position.z.toFixed(2)} m
                  </small>
                </div>
                <em>{step.grossWeightKg.toFixed(1)} kg</em>
              </li>
            ))}
          </ol>
        </div>
      ) : error ? (
        <Note tone="danger">Talimat üretilemedi. {error.message}</Note>
      ) : (
        <div className="loadstudio__loading">Talimat hazırlanıyor…</div>
      )}
    </Panel>
  );
}
