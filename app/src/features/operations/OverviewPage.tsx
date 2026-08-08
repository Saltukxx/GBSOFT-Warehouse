import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  ConfidenceIndicator,
  MetricStrip,
  Note,
  Panel,
  Skeleton,
} from "../../components/ui/primitives";
import { Icon } from "../../components/ui/Icon";
import { Drawer } from "../../components/ui/Overlay";
import { CompletionChart } from "../../components/charts/CompletionChart";
import { fetchOverview } from "../../data/api";
import type { ExceptionItem } from "../../data/fixtures/overview";
import {
  NOW_HOUR,
  SLA_CUTOFF_HOUR,
  SLA_TARGET_LINES,
} from "../../data/fixtures/overview";
import { FACILITY } from "../../data/fixtures/facility";
import { num, pct, pctPlain, sec } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import "./overview.css";

export function OverviewPage() {
  const navigate = useNavigate();
  const [openException, setOpenException] = useState<ExceptionItem | null>(null);
  const state = useAsync((signal) => fetchOverview(signal), []);

  if (state.status === "error") {
    return (
      <div className="page">
        <PageHeader
          eyebrow="Operasyon"
          title="Operasyon genel bakış"
          description={FACILITY.name}
        />
        <div className="page__body">
          <Panel title="Veri yüklenemedi">
            <Note tone="danger">
              Operasyon özeti yüklenemedi. Son başarılı snapshot 14:02
              görüntülenebilir.
            </Note>
            <div className="row" style={{ marginTop: "var(--space-3)" }}>
              <button type="button" className="btn" onClick={state.retry}>
                Tekrar dene
              </button>
              <Link className="btn" to="/data-quality">
                Veri kalitesini aç
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  const data = state.data;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operasyon"
        title="Operasyon genel bakış"
        description={`${FACILITY.name} · ${FACILITY.openWaveCount} açık wave · ${num(
          FACILITY.dailyOrderLines,
        )} günlük order line`}
        context={
          <div className="row text-xs muted" style={{ gap: "var(--space-4)" }}>
            <span>
              Vardiya 2 · 14:00-22:00
            </span>
            <span>Son 60 dk penceresi</span>
          </div>
        }
        primaryAction={
          <Link className="btn btn--primary" to="/optimization/slotting">
            Slot planını incele
          </Link>
        }
      />

      {data ? (
        <MetricStrip
          metrics={[
            {
              label: "Wave riski",
              value: `${data.kpis.waveRiskCount} kritik`,
              delta: "+2",
              deltaTone: "negative",
              context: `${data.kpis.waveTotal} açık wave · SLA 18:00 üstü risk`,
            },
            {
              label: "Picking sapması",
              value: sec(data.kpis.pickingVarianceSecPerLine),
              delta: "plan üstü",
              deltaTone: "warning",
              context: "Son vardiya · beklenen 71,4 sn/line",
            },
            {
              label: "Aktif görev",
              value: num(data.kpis.activeTasks),
              context: "26 picker · 4 zon",
            },
            {
              label: "Veri güveni",
              value: pctPlain(data.kpis.dataConfidencePct),
              delta: "-2 puan",
              deltaTone: "warning",
              context: "Event completeness ve SKU ölçüsü dahil",
            },
          ]}
        />
      ) : (
        <div style={{ padding: "var(--space-4) var(--space-6)" }}>
          <Skeleton height={52} />
        </div>
      )}

      <div className="page__body overview">
        <Panel
          title="Picking tamamlanma tahmini"
          note={
            <span>
              Order line · kümülatif
              <br />
              Model pick-time-1.4.2
            </span>
          }
        >
          {data ? (
            <CompletionChart
              data={data.completion}
              nowHour={NOW_HOUR}
              slaHour={SLA_CUTOFF_HOUR}
              slaTarget={SLA_TARGET_LINES}
            />
          ) : (
            <Skeleton height={232} />
          )}
        </Panel>

        <Panel
          title="Müdahale kuyruğu"
          note={data ? `${data.exceptions.length} açık istisna` : undefined}
          flush
        >
          {data ? (
            <ol className="queue">
              {data.exceptions.map((item) => (
                <li className="queue__item" key={item.id}>
                  <span className="queue__rank mono">
                    {String(item.rank).padStart(2, "0")}
                  </span>
                  <div className="queue__main">
                    <div className="queue__type">{item.type}</div>
                    <div className="queue__impact">{item.impact}</div>
                    <div className="queue__meta">
                      Güven {pctPlain(item.confidencePct)} · {item.impactDetail}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setOpenException(item)}
                    aria-label={`${item.type} incele`}
                  >
                    İncele
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div style={{ padding: "var(--space-4)" }}>
              <Skeleton height={180} />
            </div>
          )}
        </Panel>

        <Panel title="Zone iş yükü" note="Açık order line · atanmış picker">
          {data ? (
            <div className="zoneload">
              {data.zoneWorkload.map((z) => (
                <div className="zoneload__row" key={z.zone}>
                  <div className="zoneload__label">
                    <strong>{z.label}</strong>
                    <span className="text-2xs subtle">
                      {z.pickersAssigned} picker · {z.activeTasks} görev
                    </span>
                  </div>
                  <div className="zoneload__track">
                    <div
                      className="zoneload__fill"
                      style={{
                        width: `${(z.openLines / 1000) * 100}%`,
                        background:
                          z.loadIndexPct > 110
                            ? "var(--amber-700)"
                            : "var(--ink-700)",
                      }}
                    />
                  </div>
                  <div className="zoneload__value mono">
                    {num(z.openLines)}
                  </div>
                  <div
                    className={`zoneload__index mono ${
                      z.loadIndexPct > 110 ? "tone-warning" : "muted"
                    }`}
                  >
                    {pctPlain(z.loadIndexPct)} kapasite
                  </div>
                </div>
              ))}
              <p className="text-2xs subtle" style={{ marginTop: 8 }}>
                Kapasite endeksi = açık line / vardiya kapasitesi. %100 üstü,
                vardiya sonuna kadar tamamlanamama riskini gösterir.
              </p>
            </div>
          ) : (
            <Skeleton height={160} />
          )}
        </Panel>

        <Panel
          title="Son optimizer planı"
          note={data ? `Plan ${data.plan.id}` : undefined}
        >
          {data ? (
            <div className="stack stack-3">
              <dl className="deflist">
                <dt>Net operasyon etkisi</dt>
                <dd className="tone-positive">
                  {pct(data.plan.netOperationDeltaPct)}
                </dd>
                <dt>Picking süresi</dt>
                <dd>{pct(data.plan.pickingTimeDeltaPct)}</dd>
                <dt>Yürüyüş</dt>
                <dd>{pct(data.plan.walkingDeltaPct)}</dd>
                <dt>Replenishment</dt>
                <dd className="tone-warning">
                  {pct(data.plan.replenishmentDeltaPct)}
                </dd>
                <dt>Taşıma işi</dt>
                <dd>{data.plan.moveTaskCount} görev</dd>
                <dt>Hard constraint ihlali</dt>
                <dd>{data.plan.hardViolationCount}</dd>
              </dl>

              <ConfidenceIndicator
                label="Plan uygulanabilirliği"
                valuePct={96}
                detail="21 SKU · 0 hard constraint ihlali · 6 SKU veri eksikliğiyle kapsam dışı"
              />

              <Note tone="neutral">
                Değerler demo simülasyonudur; gerçek WMS verisi bağlandığında
                kalibre edilir.
              </Note>

              <div className="row">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => navigate("/optimization/slotting")}
                >
                  Planı incele
                  <Icon name="chevronRight" size={14} />
                </button>
                <Link className="btn" to="/optimization/moves">
                  Taşıma görevleri
                </Link>
              </div>
            </div>
          ) : (
            <Skeleton height={220} />
          )}
        </Panel>
      </div>

      {openException ? (
        <Drawer
          title={openException.type}
          subtitle={`${openException.id} · güven ${pctPlain(
            openException.confidencePct,
          )}`}
          onClose={() => setOpenException(null)}
          footer={
            <>
              {openException.linkTo === "time" ? (
                <Link
                  className="btn btn--primary"
                  to="/analysis/time?component=travel"
                  onClick={() => setOpenException(null)}
                >
                  Time Intelligence'ta aç
                </Link>
              ) : null}
              {openException.linkTo === "slotting" ? (
                <Link
                  className="btn btn--primary"
                  to="/optimization/slotting"
                  onClick={() => setOpenException(null)}
                >
                  Slotting Studio'da aç
                </Link>
              ) : null}
              {openException.linkTo === "data-quality" ? (
                <Link
                  className="btn btn--primary"
                  to="/data-quality"
                  onClick={() => setOpenException(null)}
                >
                  Veri kalitesinde aç
                </Link>
              ) : null}
              <Link
                className="btn"
                to="/optimization/slotting"
                onClick={() => setOpenException(null)}
              >
                Slotting fırsatlarını göster
              </Link>
            </>
          }
        >
          <div className="stack stack-5">
            <section>
              <h3 className="section-label">Sorun özeti</h3>
              <p className="text-sm" style={{ marginTop: 4 }}>
                {openException.summary}
              </p>
            </section>

            <section>
              <h3 className="section-label">Etki</h3>
              <dl className="deflist" style={{ marginTop: 4 }}>
                <dt>Tahmini etki</dt>
                <dd>{openException.impact}</dd>
                <dt>Kapsam</dt>
                <dd>{openException.impactDetail}</dd>
                <dt>Veri güveni</dt>
                <dd>{pctPlain(openException.confidencePct)}</dd>
              </dl>
            </section>

            {openException.componentImpact.length > 0 ? (
              <section>
                <h3 className="section-label">Süre bileşenleri</h3>
                <table
                  className="table table--compact"
                  style={{ marginTop: 4 }}
                >
                  <caption className="sr-only">
                    İstisnanın picking süresi bileşenlerine etkisi
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Bileşen</th>
                      <th scope="col" className="num">
                        Sapma
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {openException.componentImpact.map((c) => (
                      <tr key={c.label}>
                        <th scope="row" style={{ fontWeight: 400 }}>
                          {c.label}
                        </th>
                        <td className="num mono tone-negative">
                          {sec(c.deltaSec)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {openException.affectedWaves.length > 0 ? (
              <section>
                <h3 className="section-label">Etkilenen wave'ler</h3>
                <div
                  className="row"
                  style={{ flexWrap: "wrap", marginTop: 6, gap: 6 }}
                >
                  {openException.affectedWaves.map((w) => (
                    <span className="tag tag--info mono" key={w}>
                      {w}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}
