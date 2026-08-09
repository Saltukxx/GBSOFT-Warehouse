import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  MetricStrip,
  Note,
  Panel,
  Skeleton,
  StatusTag,
} from "../../components/ui/primitives";
import { Drawer } from "../../components/ui/Overlay";
import { DataTable } from "../../components/data-table/DataTable";
import type { Column } from "../../components/data-table/DataTable";
import { fetchDataQuality } from "../../data/api";
import type { QualityIssue } from "@gbsoft/domain";
import { num, pctPlain } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import "./dataquality.css";

export function DataQualityPage() {
  const state = useAsync((signal) => fetchDataQuality(signal), []);
  const [openIssue, setOpenIssue] = useState<QualityIssue | null>(null);

  const issueColumns: Array<Column<QualityIssue>> = [
    {
      key: "priority",
      header: "Öncelik",
      width: 84,
      cell: (r) => (
        <span
          className={
            r.priority === "Kritik"
              ? "tone-negative"
              : r.priority === "Yüksek"
                ? "tone-warning"
                : "muted"
          }
          style={{ fontWeight: 500 }}
        >
          {r.priority}
        </span>
      ),
      sortValue: (r) => ["Kritik", "Yüksek", "Orta", "Düşük"].indexOf(r.priority),
    },
    {
      key: "problem",
      header: "Problem",
      cell: (r) => r.problem,
      sortValue: (r) => r.problem,
    },
    {
      key: "affected",
      header: "Etkilenen",
      align: "right",
      cell: (r) => <span className="mono">{r.affectedLabel}</span>,
    },
    { key: "impact", header: "Etki", cell: (r) => r.impact },
    { key: "owner", header: "Sorumlu", cell: (r) => r.owner, secondary: true },
    {
      key: "action",
      header: "Eylem",
      cell: (r) => (
        <button
          type="button"
          className="btn btn--sm"
          onClick={(e) => {
            e.stopPropagation();
            setOpenIssue(r);
          }}
        >
          {r.action}
        </button>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Sistem"
        title="Veri kalitesi"
        description="Slot planının kalitesi fiziksel veri kalitesine bağlıdır. Kritik eksikler plan yayınını bloklar."
      />

      {state.data ? (
        <MetricStrip
          metrics={[
            {
              label: "Genel readiness",
              value: pctPlain(state.data.readinessPct),
              delta: "eşik %95",
              deltaTone: state.data.readinessPct >= 95 ? "positive" : "warning",
              context:
                state.data.readinessPct >= 95
                  ? "Ağırlıklı coverage · readiness eşiği karşılandı"
                  : "Ağırlıklı coverage · readiness eşiğinin altında",
            },
            {
              label: "Plan bloklayan sorun",
              value: String(state.data.blockingIssueCount),
              context: state.data.publishGate.allowed
                ? "Plan yayın kapısı açık"
                : (state.data.publishGate.reason ?? "Yayın kapısı bloklu"),
            },
            {
              label: "Açık sorun",
              value: String(state.data.issues.length),
              context: "Gerçek veri snapshot'ından hesaplandı",
            },
            {
              label: "Son doğrulama",
              value: new Date(state.data.lastValidatedAt).toLocaleTimeString(
                "tr-TR",
                { hour: "2-digit", minute: "2-digit" },
              ),
              context: state.data.facilityCode,
            },
          ]}
        />
      ) : (
        <div style={{ padding: "var(--space-4) var(--space-6)" }}>
          <Skeleton height={52} />
        </div>
      )}

      <div className="page__body dq">
        <Panel title="Coverage" note="Eşik altındaki satırlar amber gösterilir">
          {state.data ? (
            <div>
              {state.data.coverage.map((row) => (
                <div className="coverage" key={row.key}>
                  <div>
                    <div className="text-sm">{row.label}</div>
                    <div className="text-2xs subtle">{row.context}</div>
                  </div>
                  <div className="coverage__track">
                    <div
                      className={`coverage__fill${
                        row.valuePct < row.threshold
                          ? " coverage__fill--warn"
                          : ""
                      }`}
                      style={{ width: `${row.valuePct}%` }}
                    />
                  </div>
                  <div className="coverage__value">
                    {num(row.valuePct, row.valuePct % 1 === 0 ? 0 : 1)}%
                  </div>
                </div>
              ))}
              <p className="text-2xs subtle" style={{ marginTop: 10 }}>
                Coverage, son 14 günlük snapshot üzerinden hesaplanır. Eşikler
                müşteri profilinde versiyonlanır.
              </p>
            </div>
          ) : (
            <Skeleton height={200} />
          )}
        </Panel>

        <Panel title="Kaynak sistem sağlığı" note="Entegrasyon katmanı" flush>
          <table className="table table--compact">
            <caption className="sr-only">
              Kaynak sistemlerin senkron durumu ve veri tamlığı
            </caption>
            <thead>
              <tr>
                <th scope="col">Kaynak</th>
                <th scope="col">Yöntem</th>
                <th scope="col">Son senkron</th>
                <th scope="col" className="num">
                  Tamlık
                </th>
                <th scope="col">Durum</th>
              </tr>
            </thead>
            <tbody>
              {state.data?.sourceHealth.map((s) => (
                <tr key={s.source}>
                  <th scope="row" style={{ fontWeight: 400 }}>
                    {s.source}
                  </th>
                  <td className="muted">{s.mode}</td>
                  <td className="mono">{s.lastSync}</td>
                  <td className="num mono">{num(s.completenessPct, 1)}%</td>
                  <td>
                    <StatusTag status={s.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          title="Problem listesi"
          note="Önceliğe göre sıralı"
          flush
          className="dq__issues"
        >
          {state.data ? (
            <DataTable
              columns={issueColumns}
              rows={state.data.issues}
              rowKey={(r) => r.id}
              caption="Veri kalitesi sorunları"
              onSelect={(r) => setOpenIssue(r)}
            />
          ) : (
            <div style={{ padding: "var(--space-4)" }}>
              <Skeleton height={120} />
            </div>
          )}
        </Panel>
      </div>

      {openIssue ? (
        <Drawer
          title={openIssue.problem}
          subtitle={`${openIssue.id} · ${openIssue.priority} öncelik · ${openIssue.affectedLabel}`}
          onClose={() => setOpenIssue(null)}
          footer={
            <>
              <button type="button" className="btn btn--primary">
                {openIssue.action} oluştur
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setOpenIssue(null)}
              >
                Kapat
              </button>
            </>
          }
        >
          <div className="stack stack-5">
            <section>
              <h3 className="section-label">Ne oldu?</h3>
              <p className="text-sm" style={{ marginTop: 4 }}>
                {openIssue.detail}
              </p>
            </section>

            <section>
              <h3 className="section-label">Etkilenen kayıtlar</h3>
              {openIssue.affectedIds.length > 0 ? (
                <div
                  className="row"
                  style={{ flexWrap: "wrap", marginTop: 6, gap: 6 }}
                >
                  {openIssue.affectedIds.map((id) => (
                    <span className="tag tag--info mono" key={id}>
                      {id}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm muted" style={{ marginTop: 6 }}>
                  Sorun tesis veya veri akışı seviyesinde; tekil kayıt listesi yok.
                </p>
              )}
              {openIssue.blocksPublish ? (
                <div style={{ marginTop: 10 }}>
                  <Note tone="warning">
                    Bu sorun çözülene kadar plan yayın kapısı kapalıdır.
                  </Note>
                </div>
              ) : null}
            </section>

            <section>
              <h3 className="section-label">Sorumlu ve eylem</h3>
              <dl className="deflist" style={{ marginTop: 4 }}>
                <dt>Sorumlu</dt>
                <dd>{openIssue.owner}</dd>
                <dt>Önerilen eylem</dt>
                <dd>{openIssue.action}</dd>
                <dt>Etki</dt>
                <dd>{openIssue.impact}</dd>
              </dl>
            </section>
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}
