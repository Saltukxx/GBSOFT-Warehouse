import type { LoadExecutionView, TruckLoadPlanView } from "@gbsoft/domain";
import { Note, Panel, StatusTag } from "../../components/ui/primitives";
import { EXECUTION_LABEL, SCAN_LABEL } from "./labels";

export type ScanOutcome = "confirmed" | "missing" | "damaged";

/**
 * Shadow yürütme paneli: yayına alma, barkod teyidi ve sapma replanı.
 *
 * Panel adında "shadow" geçmesi süs değil: bu ekrandaki hiçbir eylem dış
 * sisteme görev göndermez, hepsi kendi kayıtlarımıza yazılır. Canlı WMS/TMS
 * yazımı Faz 9 yetki kapısı tamamlanana kadar kapalıdır.
 */
export function ExecutionPanel({
  plan,
  execution,
  error,
  loaded,
  busy,
  scanCode,
  scanOutcome,
  onScanCodeChange,
  onScanOutcomeChange,
  onPublish,
  onSubmitScan,
  onDeviationReplan,
}: {
  plan: TruckLoadPlanView;
  execution: LoadExecutionView | null;
  error: Error | null;
  /** Yürütme kaydı okundu mu — "kayıt yok" ile "henüz bilinmiyor" farklıdır. */
  loaded: boolean;
  busy: boolean;
  scanCode: string;
  scanOutcome: ScanOutcome;
  onScanCodeChange: (code: string) => void;
  onScanOutcomeChange: (outcome: ScanOutcome) => void;
  onPublish: () => void;
  onSubmitScan: () => void;
  onDeviationReplan: () => void;
}) {
  return (
    <Panel
      title="Shadow execution"
      note={<span className="text-2xs muted">Canlı WMS yazımı kapalı</span>}
      action={execution ? <StatusTag status={EXECUTION_LABEL[execution.state]} /> : null}
    >
      {loaded && !execution ? (
        <div className="loadstudio__publish-gate">
          <div>
            <strong>Plan yürütmeye hazır</strong>
            <span>
              Barkod/SSCC teyidi shadow modunda kaydedilir; dış sisteme görev
              gönderilmez.
            </span>
          </div>
          {/* Yalnız bağımsız doğrulamadan geçmiş plan yayına alınabilir. */}
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || plan.state !== "validated"}
            onClick={onPublish}
          >
            Shadow yayına al
          </button>
        </div>
      ) : null}

      {execution ? (
        <div className="loadstudio__execution-body">
          <div className="loadstudio__execution-kpis">
            <div>
              <span>Teyit</span>
              <strong>
                {execution.loadedCount}/{execution.totalCount}
              </strong>
            </div>
            <div>
              <span>Sapma</span>
              <strong>{execution.deviationCount}</strong>
            </div>
            <div>
              <span>Sıradaki</span>
              <strong>{execution.nextExpectedCode ?? "Tamamlandı"}</strong>
            </div>
          </div>

          {execution.state !== "completed" ? (
            <form
              className="loadstudio__scan-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmitScan();
              }}
            >
              <label>
                <span>Barkod / SSCC</span>
                <input
                  autoComplete="off"
                  value={scanCode}
                  onChange={(event) => onScanCodeChange(event.target.value)}
                  placeholder={execution.nextExpectedCode ?? "Kod okutun"}
                />
              </label>
              <label>
                <span>Sonuç</span>
                <select
                  value={scanOutcome}
                  onChange={(event) =>
                    onScanOutcomeChange(event.target.value as ScanOutcome)
                  }
                >
                  <option value="confirmed">Yüklendi</option>
                  <option value="missing">Eksik</option>
                  <option value="damaged">Hasarlı</option>
                </select>
              </label>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={busy || scanCode.trim().length === 0}
              >
                Teyit et
              </button>
              {execution.nextExpectedCode ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => onScanCodeChange(execution.nextExpectedCode ?? "")}
                >
                  Bekleneni doldur
                </button>
              ) : null}
            </form>
          ) : (
            <Note tone="positive">
              Tüm yükler sırasıyla teyit edildi; sevkiyat yüklendi durumuna geçti.
            </Note>
          )}

          {execution.state === "deviated" ? (
            <div className="loadstudio__deviation-action">
              <Note tone="warning">
                Eksik, hasarlı, bilinmeyen veya sıra dışı okutma tespit edildi.
              </Note>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || Boolean(execution.replacementPlanId)}
                onClick={onDeviationReplan}
              >
                {execution.replacementPlanId
                  ? "Yeni sürüm üretildi"
                  : "Sapmayı yeniden planla"}
              </button>
            </div>
          ) : null}

          {execution.events.length > 0 ? (
            <ol className="loadstudio__scan-events">
              {execution.events.map((event) => (
                <li key={event.id} data-outcome={event.outcome}>
                  <strong>{SCAN_LABEL[event.outcome]}</strong>
                  <span>{event.unitCode ?? event.scannedCode}</span>
                  <small>
                    beklenen #{event.expectedSeq ?? "—"} · okunan #
                    {event.actualSeq ?? "—"}
                  </small>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {error ? <Note tone="danger">Execution okunamadı. {error.message}</Note> : null}
    </Panel>
  );
}
