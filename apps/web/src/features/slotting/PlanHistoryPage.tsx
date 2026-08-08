import { PageHeader } from "../../components/ui/PageHeader";
import { Note, Panel, StatusTag } from "../../components/ui/primitives";
import { usePlanStore } from "../../app/planStore";
import { PLAN_VERSIONS } from "../../data/fixtures/slotPlan";
import { VERSIONS } from "../../data/fixtures/facility";
import { pct } from "../../lib/format";

/**
 * Plan geçmişi — rollback yapılabileceğini gösterir (§1.4).
 * Her sürüm hangi veri ve model sürümüyle üretildiğini taşır.
 */
export function PlanHistoryPage() {
  const store = usePlanStore();

  const rows = [
    ...PLAN_VERSIONS,
    ...(store.activePlanId === "SP-2026-081-R1"
      ? [
          {
            id: "SP-2026-081-R1",
            createdAt: "08.08.2026 14:48",
            createdBy: "Ayşe Yılmaz · kilitli atama",
            netOperationDeltaPct: -7.2,
            moveTaskCount: 24,
            note: "SKU-184 → A-03-02 kilitlendi; iki bağlı paket plandan çıktı.",
            state: "aktif" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Optimizasyon"
        title="Plan geçmişi"
        description="Her plan sürümü veri snapshot'ı, model ve solver sürümüyle birlikte saklanır; sonuç bozulursa önceki sürüme dönülebilir."
      />
      <div className="page__body stack stack-4">
        <Panel title="Sürümler" flush>
          <table className="table table--compact">
            <caption className="sr-only">Slot planı sürümleri</caption>
            <thead>
              <tr>
                <th scope="col">Plan</th>
                <th scope="col">Oluşturma</th>
                <th scope="col">Kim</th>
                <th scope="col" className="num">
                  Net etki
                </th>
                <th scope="col" className="num">
                  Görev
                </th>
                <th scope="col">Not</th>
                <th scope="col">Durum</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                    {v.id}
                  </th>
                  <td className="mono">{v.createdAt}</td>
                  <td className="muted">{v.createdBy}</td>
                  <td className="num mono">{pct(v.netOperationDeltaPct)}</td>
                  <td className="num mono">{v.moveTaskCount}</td>
                  <td className="muted" style={{ whiteSpace: "normal" }}>
                    {v.note}
                  </td>
                  <td>
                    <StatusTag
                      status={v.state === "aktif" ? "Uygulandı" : "Bekliyor"}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={v.state === "aktif"}
                      onClick={() => store.reset()}
                    >
                      Bu sürüme dön
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Lineage" note="Aktif plan">
          <dl className="deflist" style={{ maxWidth: 520 }}>
            <dt>Aktif plan</dt>
            <dd className="mono">{store.plan.id}</dd>
            <dt>Veri snapshot'ı</dt>
            <dd className="mono">08.08.2026 14:32</dd>
            <dt>Model sürümü</dt>
            <dd className="mono">{VERSIONS.model}</dd>
            <dt>Solver sürümü</dt>
            <dd className="mono">{VERSIONS.solver}</dd>
            <dt>Objective profili</dt>
            <dd>Dengeli</dd>
            <dt>Kullanıcı müdahalesi</dt>
            <dd>
              {store.locks.length} kilit · {store.excludedSkuIds.length} plan dışı
            </dd>
          </dl>
          <div style={{ marginTop: 12, maxWidth: 620 }}>
            <Note tone="neutral">
              Geri alma işlemi taşıma görevlerini iptal etmez; yalnız planı
              önceki sürüme döndürür. Yayınlanmış görevler ayrı bir iptal akışı
              gerektirir.
            </Note>
          </div>
        </Panel>
      </div>
    </div>
  );
}
