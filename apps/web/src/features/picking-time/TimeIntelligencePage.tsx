import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Note, Panel, Skeleton } from "../../components/ui/primitives";
import { TimeDecompositionBar } from "../../components/charts/TimeDecompositionBar";
import { MapSurface } from "../../components/warehouse-map/MapSurface";
import { DataTable } from "../../components/data-table/DataTable";
import type { Column } from "../../components/data-table/DataTable";
import type { ComponentKey } from "@gbsoft/domain";
import { PICK_TIME_COMPONENTS } from "@gbsoft/domain";
import { fetchPickingTime } from "../../data/api";
import { useLayout } from "../../data/useLayout";
import {
  CONGESTED_AISLES,
  TRAVEL_ROUTE_SEGMENTS,
} from "@gbsoft/seed";
import type { VarianceRow } from "@gbsoft/seed";
import { num, pctPlain, sec, secPlain } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import "./time.css";

const ZONE_OPTIONS = ["Tüm zonlar", "Zone A", "Zone B", "Zone C", "Zone D"];
const WAVE_OPTIONS = ["Tüm wave'ler", "W-2261", "W-2264", "W-2265", "W-2268"];
const CLASS_OPTIONS = ["Tüm sınıflar", "A sınıfı", "B sınıfı", "C sınıfı"];
const EQUIPMENT_OPTIONS = ["Tüm ekipman", "Manuel", "Araba", "Forklift"];
const RANGE_OPTIONS = ["Son 14 vardiya", "Son vardiya", "Son 7 gün", "Son 30 gün"];

export function TimeIntelligencePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const componentParam = searchParams.get("component") as ComponentKey | null;
  const [selected, setSelected] = useState<ComponentKey | null>(componentParam);
  const [scope, setScope] = useState("normal");
  const [zone, setZone] = useState(ZONE_OPTIONS[0]);

  const state = useAsync((signal) => fetchPickingTime(signal), []);
  const twin = useLayout();

  const selectedMeta = useMemo(
    () => PICK_TIME_COMPONENTS.find((c) => c.key === selected) ?? null,
    [selected],
  );

  function handleSelect(key: ComponentKey | null) {
    setSelected(key);
    const next = new URLSearchParams(searchParams);
    if (key) next.set("component", key);
    else next.delete("component");
    setSearchParams(next, { replace: true });
  }

  const varianceColumns: Array<Column<VarianceRow>> = [
    {
      key: "component",
      header: "Bileşen",
      cell: (r) => (
        <span style={{ fontWeight: selected === r.key ? 600 : 400 }}>
          {r.component}
        </span>
      ),
      sortValue: (r) => r.component,
    },
    {
      key: "expected",
      header: "Beklenen",
      align: "right",
      cell: (r) => <span className="mono">{secPlain(r.expected)}</span>,
      sortValue: (r) => r.expected,
    },
    {
      key: "actual",
      header: "Gerçekleşen",
      align: "right",
      cell: (r) => <span className="mono">{secPlain(r.actual)}</span>,
      sortValue: (r) => r.actual,
    },
    {
      key: "delta",
      header: "Sapma",
      align: "right",
      cell: (r) => (
        <span className={`mono ${r.delta > 1 ? "tone-negative" : "muted"}`}>
          {sec(r.delta)}
        </span>
      ),
      sortValue: (r) => r.delta,
    },
    {
      key: "cause",
      header: "Ana neden",
      cell: (r) => (
        <span className={r.causeTone === "attention" ? "" : "muted"}>
          {r.rootCause}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Analiz"
        title="Time Intelligence"
        description="Picking süresi bileşenlerine ayrılır; slot optimizer'a giden maliyetin hangi veriden geldiği burada görünür."
        primaryAction={
          <Link className="btn btn--primary" to="/optimization/slotting">
            Slotting Studio'da aç
          </Link>
        }
      />

      <div className="toolbar">
        <label className="field">
          <span className="field__label">Tesis</span>
          <select className="select" defaultValue="Marmara DM">
            <option>Marmara DM</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Zone</span>
          <select
            className="select"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            {ZONE_OPTIONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Wave</span>
          <select className="select" defaultValue={WAVE_OPTIONS[0]}>
            {WAVE_OPTIONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">SKU sınıfı</span>
          <select className="select" defaultValue={CLASS_OPTIONS[0]}>
            {CLASS_OPTIONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Ekipman</span>
          <select className="select" defaultValue={EQUIPMENT_OPTIONS[0]}>
            {EQUIPMENT_OPTIONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Zaman aralığı</span>
          <select className="select" defaultValue={RANGE_OPTIONS[0]}>
            {RANGE_OPTIONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Görev kapsamı</span>
          <select
            className="select"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="normal">Normal görevler</option>
            <option value="exception">Exception görevleri</option>
            <option value="all">Tümü</option>
          </select>
        </label>
      </div>

      <div className="page__body time">
        <div className="time__main stack stack-4">
          <Panel
            title="Picking süresi bileşenleri"
            note="Bir bileşeni seçtiğinizde alt analiz güncellenir."
          >
            {state.data ? (
              <TimeDecompositionBar
                breakdown={state.data.plan}
                selected={selected}
                onSelect={handleSelect}
              />
            ) : (
              <Skeleton height={120} />
            )}
          </Panel>

          <Panel
            title="Beklenen ve gerçekleşen"
            note="Son vardiya · 2.840 order line"
            flush
          >
            {state.data ? (
              <DataTable
                columns={varianceColumns}
                rows={state.data.variance}
                rowKey={(r) => r.key}
                caption="Picking süresi bileşenlerinde beklenen ve gerçekleşen değerler"
                selectedKey={selected}
                onSelect={(r) =>
                  handleSelect(
                    selected === r.key ? null : (r.key as ComponentKey),
                  )
                }
              />
            ) : (
              <div style={{ padding: "var(--space-4)" }}>
                <Skeleton height={140} />
              </div>
            )}
          </Panel>

          {selected === "travel" ? (
            <Panel
              title="Travel kök neden"
              note="A-03 ve A-04 koridorları kırmızı çerçeveli"
            >
              <div className="time__route">
                <div>
                  <MapSurface
                    twin={twin}
                    layer="congestion"
                    viewMode="current"
                    zoneFilter="all"
                    selectedId={null}
                    onSelect={() => {}}
                    arrows={[]}
                    sourceIds={new Set()}
                    targetIds={new Set()}
                    lockedIds={new Set()}
                    excludedIds={new Set()}
                    highlightAisles={CONGESTED_AISLES}
                    height={260}
                  />
                </div>
                <div>
                  <h3 className="section-label">
                    Baseline ve gerçekleşen route
                  </h3>
                  <table
                    className="table table--compact"
                    style={{ marginTop: 6 }}
                  >
                    <caption className="sr-only">
                      Route segmentlerinde baseline ve gerçekleşen süre
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Segment</th>
                        <th scope="col" className="num">
                          Baseline
                        </th>
                        <th scope="col" className="num">
                          Gerçekleşen
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {TRAVEL_ROUTE_SEGMENTS.map((s) => (
                        <tr key={s.id}>
                          <th scope="row" style={{ fontWeight: 400 }}>
                            {s.congested ? (
                              <span className="tone-negative">● </span>
                            ) : null}
                            {s.label}
                          </th>
                          <td className="num mono">{secPlain(s.baselineSec)}</td>
                          <td
                            className={`num mono ${
                              s.congested ? "tone-negative" : ""
                            }`}
                          >
                            {secPlain(s.actualSec)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs muted" style={{ marginTop: 8 }}>
                    Toplam sapmanın {secPlain(8.2)}'si A-02→A-03 ve A-03→A-04
                    segmentlerinden geliyor. Bu iki segment aynı zamanda
                    replenishment görevlerinin yoğunlaştığı bölge.
                  </p>
                  <div className="row" style={{ marginTop: "var(--space-3)" }}>
                    <Link className="btn btn--primary" to="/optimization/slotting">
                      Slotting Studio'da etkilenen SKU'ları aç
                    </Link>
                  </div>
                </div>
              </div>
            </Panel>
          ) : null}

          {selectedMeta && selected !== "travel" ? (
            <Panel title={`${selectedMeta.label} bileşeni`}>
              <p className="text-sm">{selectedMeta.definition}</p>
              <p className="text-sm muted" style={{ marginTop: 8 }}>
                {selected === "congestion"
                  ? "Congestion kaybının %71'i A-03 ve A-04 koridorlarında oluşuyor. Slot planı bu iki koridordaki pick yoğunluğunu dağıtıyor."
                  : selected === "search"
                    ? "Arama süresi, görsel olarak benzer 11 SKU'nun komşu gözlerde durmasından etkileniyor. Slot planı bu SKU'lardan 4'ünü ayırıyor."
                    : "Bu bileşen plan değerine yakın seyrediyor; slot optimizasyonundan anlamlı kazanç beklenmiyor."}
              </p>
            </Panel>
          ) : null}
        </div>

        <aside className="time__side stack stack-4">
          <Panel title="Model kalitesi" note="Tahmin katmanı">
            {state.data ? (
              <div className="stack stack-3">
                <dl className="deflist">
                  <dt>P50 kalibrasyon</dt>
                  <dd>{state.data.modelQuality.p50Calibration}</dd>
                  <dt>P90 coverage</dt>
                  <dd>{pctPlain(state.data.modelQuality.p90CoveragePct)}</dd>
                  <dt>Data completeness</dt>
                  <dd>
                    {pctPlain(state.data.modelQuality.dataCompletenessPct)}
                  </dd>
                  <dt>Model sürümü</dt>
                  <dd className="mono">{state.data.modelQuality.modelVersion}</dd>
                  <dt>Son güncelleme</dt>
                  <dd className="mono">{state.data.modelQuality.updatedAt}</dd>
                </dl>
                <p className="text-2xs subtle">
                  Eğitim penceresi {state.data.modelQuality.trainingWindow} ·{" "}
                  {num(state.data.modelQuality.sampleLines)} order line.{" "}
                  {state.data.modelQuality.p50CalibrationDetail}.
                </p>
                <Note tone="neutral">
                  P90 coverage hedef aralığın altında kalırsa tahmin aralığı
                  genişletilir; plan kazancı buna göre yeniden ölçülür.
                </Note>
              </div>
            ) : (
              <Skeleton height={180} />
            )}
          </Panel>

          <Panel title="Gerçekleşen dağılım" note="Son vardiya">
            {state.data ? (
              <dl className="deflist">
                <dt>Gerçekleşen P50</dt>
                <dd className="mono">{secPlain(state.data.actual.p50Sec)}</dd>
                <dt>Gerçekleşen P90</dt>
                <dd className="mono">{secPlain(state.data.actual.p90Sec)}</dd>
                <dt>Plan P50</dt>
                <dd className="mono">{secPlain(state.data.plan.p50Sec)}</dd>
                <dt>Sapma</dt>
                <dd className="mono tone-negative">
                  {sec(state.data.actual.p50Sec - state.data.plan.p50Sec)}
                </dd>
              </dl>
            ) : (
              <Skeleton height={120} />
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
