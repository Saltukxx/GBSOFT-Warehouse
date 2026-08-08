import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  ConfidenceIndicator,
  Note,
  Segmented,
  StatusTag,
} from "../../components/ui/primitives";
import { Icon } from "../../components/ui/Icon";
import { WarehouseMap } from "../../components/warehouse-map/WarehouseMap";
import type { MoveArrow } from "../../components/warehouse-map/WarehouseMap";
import { LAYERS } from "../../components/warehouse-map/layers";
import type { LayerId } from "../../components/warehouse-map/layers";
import { OptimizerModal } from "./OptimizerModal";
import { usePlanStore } from "../../app/planStore";
import type { ZoneId } from "../../domain/warehouse";
import { parseZone } from "../../domain/warehouse";
import { LOCATIONS, getLocation } from "../../data/fixtures/layout";
import { SKU_BY_LOCATION, getSku } from "../../data/fixtures/skus";
import {
  RECOMMENDATIONS,
  RECOMMENDATION_BY_LOCATION,
  RECOMMENDATION_BY_SKU,
} from "../../data/fixtures/slotPlan";
import { hours, num, pct, pctPlain, secPlain, signed } from "../../lib/format";
import "./slotting.css";

type ViewMode = "current" | "proposed" | "diff";

export function SlottingStudioPage() {
  const store = usePlanStore();
  const { plan } = store;

  const [viewMode, setViewMode] = useState<ViewMode>("proposed");
  const [layer, setLayer] = useState<LayerId>("pickTime");
  const [zoneFilter, setZoneFilter] = useState<ZoneId | "all">("all");
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    null,
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [optimizerOpen, setOptimizerOpen] = useState(false);

  // Değişen KPI'ların 180 ms vurgusu — sayılar count-up yapmaz (§8.8).
  useEffect(() => {
    if (store.changedKeys.length === 0) return;
    const timer = window.setTimeout(() => store.clearChanged(), 1200);
    return () => window.clearTimeout(timer);
  }, [store]);

  const activeRecommendations = useMemo(
    () =>
      plan.recommendations.filter(
        (r) => !store.excludedSkuIds.includes(r.skuId),
      ),
    [plan.recommendations, store.excludedSkuIds],
  );

  const sourceIds = useMemo(
    () => new Set(activeRecommendations.map((r) => r.sourceLocationId)),
    [activeRecommendations],
  );
  const targetIds = useMemo(
    () => new Set(activeRecommendations.map((r) => r.targetLocationId)),
    [activeRecommendations],
  );
  const lockedLocationIds = useMemo(
    () => new Set(store.locks.map((l) => l.locationId)),
    [store.locks],
  );
  const excludedLocationIds = useMemo(() => {
    const ids = new Set(store.blockedLocationIds);
    for (const skuId of store.excludedSkuIds) {
      const rec = RECOMMENDATION_BY_SKU.get(skuId);
      if (rec) ids.add(rec.targetLocationId);
    }
    return ids;
  }, [store.blockedLocationIds, store.excludedSkuIds]);

  const arrows: MoveArrow[] = useMemo(() => {
    if (viewMode === "current") return [];
    const scoped = activeRecommendations.filter((r) => {
      if (zoneFilter === "all") return true;
      return (
        parseZone(r.sourceLocationId) === zoneFilter ||
        parseZone(r.targetLocationId) === zoneFilter
      );
    });
    return selectedRecommendationArrows(
      scoped,
      selectedLocationId,
      viewMode === "diff",
    );
  }, [activeRecommendations, viewMode, zoneFilter, selectedLocationId]);

  /* --- seçim --- */

  const selectedLocation = selectedLocationId
    ? getLocation(selectedLocationId)
    : undefined;

  const selectedRecommendation = selectedLocationId
    ? RECOMMENDATION_BY_LOCATION.get(selectedLocationId)
    : undefined;

  const selectedSku = selectedRecommendation
    ? getSku(selectedRecommendation.skuId)
    : selectedLocationId
      ? SKU_BY_LOCATION.get(selectedLocationId)
      : undefined;

  const isLocked = selectedRecommendation
    ? store.isLocked(selectedRecommendation.skuId)
    : false;
  const isExcluded = selectedRecommendation
    ? store.excludedSkuIds.includes(selectedRecommendation.skuId)
    : false;

  const flash = (key: string) =>
    store.changedKeys.includes(key) ? " flash" : "";

  return (
    <div className="page">
      <PageHeader
        eyebrow="Optimizasyon"
        title="Slotting Studio"
        description={`Plan ${plan.id} · snapshot 08.08.2026 14:32 · profil dengeli`}
        context={
          <div className="row" style={{ gap: "var(--space-3)" }}>
            <Segmented<ViewMode>
              label="Görünüm modu"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "current", label: "Mevcut" },
                { value: "proposed", label: "Önerilen" },
                { value: "diff", label: "Fark" },
              ]}
            />
          </div>
        }
        primaryAction={
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setOptimizerOpen(true)}
          >
            Yeniden optimize et
          </button>
        }
        secondaryActions={
          <Link className="btn" to="/optimization/moves">
            Move Plan
          </Link>
        }
      />

      <div className="toolbar">
        <label className="field">
          <span className="field__label">Isı haritası katmanı</span>
          <select
            className="select"
            value={layer}
            onChange={(e) => setLayer(e.target.value as LayerId)}
          >
            {LAYERS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Zone</span>
          <select
            className="select"
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value as ZoneId | "all")}
          >
            <option value="all">Tüm zonlar</option>
            <option value="A">Zone A</option>
            <option value="B">Zone B</option>
            <option value="C">Zone C</option>
            <option value="D">Zone D</option>
          </select>
        </label>
        <div className="toolbar__spacer" />
        <div className="row text-xs muted" style={{ gap: "var(--space-4)" }}>
          <LegendSwatch color="var(--blue-100)" border="var(--blue-700)" label="Kaynak" />
          <LegendSwatch
            color="var(--teal-100)"
            border="var(--teal-700)"
            label="Hedef"
            dashed
          />
          <LegendSwatch color="var(--red-100)" border="var(--red-700)" label="Bloklu" />
          <span className="row" style={{ gap: 4 }}>
            <Icon name="lock" size={14} /> Kilitli
          </span>
        </div>
      </div>

      <div className="page__body--flush studio">
        <div className="studio__main">
          <WarehouseMap
            locations={LOCATIONS}
            layer={viewMode === "diff" ? "planChange" : layer}
            viewMode={viewMode}
            zoneFilter={zoneFilter}
            selectedId={selectedLocationId}
            onSelect={setSelectedLocationId}
            previewId={previewId}
            arrows={arrows}
            sourceIds={viewMode === "current" ? new Set() : sourceIds}
            targetIds={viewMode === "current" ? new Set() : targetIds}
            lockedIds={lockedLocationIds}
            excludedIds={excludedLocationIds}
          />

          <ComparisonStrip
            plan={plan}
            flash={flash}
            excludedCount={store.excludedSkuIds.length}
          />
        </div>

        <aside className="rail" aria-label="Karar paneli">
          <section className="rail__section">
            <div className="row row--between">
              <h2 className="rail__title">Plan özeti</h2>
              <span className="mono text-xs muted">{plan.id}</span>
            </div>
            <dl className="deflist" style={{ marginTop: 8 }}>
              <dt>Net operasyon etkisi</dt>
              <dd className={`tone-positive${flash("net")}`}>
                {pct(plan.netOperationDeltaPct)}
              </dd>
              <dt>Picking süresi</dt>
              <dd className={flash("picking").trim()}>
                {pct(plan.pickingTimeDeltaPct)}
              </dd>
              <dt>Yürüyüş</dt>
              <dd className={flash("walking").trim()}>
                {pct(plan.walkingDeltaPct)}
              </dd>
              <dt>Replenishment</dt>
              <dd className={`tone-warning${flash("replenishment")}`}>
                {pct(plan.replenishmentDeltaPct)}
              </dd>
              <dt>Taşıma işi</dt>
              <dd className={flash("moves").trim()}>
                {plan.moveTaskCount} görev · {hours(plan.moveHours)}
              </dd>
              <dt>Etkilenen SKU</dt>
              <dd>{plan.affectedSkuCount}</dd>
              <dt>Hard constraint</dt>
              <dd>{plan.hardViolationCount}</dd>
            </dl>

            <div style={{ marginTop: 10 }}>
              <ConfidenceIndicator
                label="Veri güveni"
                valuePct={94}
                detail="6 SKU ölçü verisi eksik olduğu için plan dışında"
              />
            </div>

            {store.lastRun ? (
              <p className="text-2xs subtle" style={{ marginTop: 8 }}>
                Son çalıştırma {store.lastRun.runId} ·{" "}
                {num(store.lastRun.solveDurationMs)} ms · durum{" "}
                {store.lastRun.status === "feasible"
                  ? "uygulanabilir"
                  : "çözüm yok"}
                .
              </p>
            ) : null}
          </section>

          <section className="rail__section rail__section--grow">
            {selectedRecommendation && selectedSku ? (
              <>
                <div className="row row--between">
                  <h2 className="rail__title">Seçili SKU</h2>
                  {isLocked ? <StatusTag status="Kilitli" /> : null}
                  {isExcluded ? <StatusTag status="Bloklu" /> : null}
                </div>

                <div className="rail__sku">
                  <div className="rail__skuname">
                    <span className="mono">{selectedSku.id}</span> ·{" "}
                    {selectedSku.name}
                  </div>
                  <div className="text-xs muted">
                    {selectedSku.category} · {selectedSku.velocityClass} sınıfı ·{" "}
                    {selectedSku.picksPerDay} pick/gün
                  </div>
                </div>

                <dl className="deflist" style={{ marginTop: 8 }}>
                  <dt>Mevcut</dt>
                  <dd className="mono">
                    {selectedRecommendation.sourceLocationId}
                  </dd>
                  <dt>Önerilen</dt>
                  <dd className="mono">
                    {selectedRecommendation.targetLocationId}
                  </dd>
                  <dt>Beklenen etki</dt>
                  <dd className="tone-positive">
                    {secPlain(
                      selectedRecommendation.expectedSecondsPerLineDelta,
                    )}
                    /line
                  </dd>
                  <dt>P90 etkisi</dt>
                  <dd>
                    {secPlain(selectedRecommendation.p90SecondsPerLineDelta)}
                    /line
                  </dd>
                </dl>

                <h3 className="section-label" style={{ marginTop: 14 }}>
                  Neden önerildi?
                </h3>
                <ol className="rail__reasons">
                  {selectedRecommendation.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ol>

                <h3 className="section-label" style={{ marginTop: 12 }}>
                  Trade-off
                </h3>
                <ul className="rail__tradeoffs">
                  {selectedRecommendation.tradeoffs.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>

                <div style={{ marginTop: 12 }}>
                  <ConfidenceIndicator
                    label="Öneri güveni"
                    valuePct={selectedRecommendation.confidencePct}
                    detail={
                      selectedRecommendation.hardConstraintsPassed
                        ? "Kapasite, ağırlık, ekipman ve zon kısıtları geçildi"
                        : "Hard constraint ihlali var"
                    }
                  />
                </div>

                <h3 className="section-label" style={{ marginTop: 14 }}>
                  Alternatif lokasyonlar
                </h3>
                <table className="table table--compact rail__alts">
                  <caption className="sr-only">
                    {selectedSku.id} için alternatif lokasyonlar ve etkileri
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Lokasyon</th>
                      <th scope="col" className="num">
                        Net etki
                      </th>
                      <th scope="col">Picking</th>
                      <th scope="col" className="num">
                        Repl.
                      </th>
                      <th scope="col">Congestion</th>
                      <th scope="col">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRecommendation.alternatives.map((alt) => (
                      <tr
                        key={alt.locationId}
                        onMouseEnter={() => setPreviewId(alt.locationId)}
                        onMouseLeave={() => setPreviewId(null)}
                        onFocus={() => setPreviewId(alt.locationId)}
                        onBlur={() => setPreviewId(null)}
                        tabIndex={0}
                      >
                        <th scope="row" className="mono" style={{ fontWeight: 400 }}>
                          {alt.locationId}
                        </th>
                        <td className="num mono">
                          {secPlain(alt.netSecondsDelta)}
                        </td>
                        <td>{alt.picking}</td>
                        <td className="num mono">
                          {alt.replenishmentDeltaPerDay === 0
                            ? "0"
                            : `${signed(alt.replenishmentDeltaPerDay, 0)}/gün`}
                        </td>
                        <td>{alt.congestion}</td>
                        <td>
                          <StatusTag status={alt.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selectedRecommendation.alternatives.some(
                  (a) => a.blockedReason,
                ) ? (
                  <ul className="rail__altnotes">
                    {selectedRecommendation.alternatives
                      .filter((a) => a.blockedReason)
                      .map((a) => (
                        <li key={a.locationId}>
                          <span className="mono">{a.locationId}</span>{" "}
                          {a.blockedReason}
                        </li>
                      ))}
                  </ul>
                ) : null}
              </>
            ) : selectedLocation ? (
              <>
                <h2 className="rail__title">Seçili lokasyon</h2>
                <div className="rail__sku">
                  <div className="rail__skuname mono">{selectedLocation.id}</div>
                  <div className="text-xs muted">
                    Zone {selectedLocation.zone} · koridor{" "}
                    {String(selectedLocation.aisle).padStart(2, "0")} · göz{" "}
                    {selectedLocation.bay} · seviye {selectedLocation.level}
                  </div>
                </div>
                <dl className="deflist" style={{ marginTop: 8 }}>
                  <dt>Mevcut SKU</dt>
                  <dd className="mono">
                    {SKU_BY_LOCATION.get(selectedLocation.id)?.id ?? "boş"}
                  </dd>
                  <dt>Dock mesafesi</dt>
                  <dd className="mono">
                    {num(selectedLocation.distanceToDockM, 1)} m
                  </dd>
                  <dt>Picking süresi</dt>
                  <dd className="mono">
                    {secPlain(selectedLocation.pickTimeSec)}
                  </dd>
                  <dt>Congestion</dt>
                  <dd className="mono">
                    {num(selectedLocation.congestionScore, 2)}
                  </dd>
                  <dt>Kapasite</dt>
                  <dd className="mono">
                    {num(selectedLocation.maxWeightKg)} kg ·{" "}
                    {num(selectedLocation.maxVolumeM3, 1)} m³
                  </dd>
                  <dt>Ergonomi</dt>
                  <dd>
                    {selectedLocation.goldenZone ? "Altın bölge" : "Standart"}
                  </dd>
                </dl>
                {selectedLocation.blocked ? (
                  <div style={{ marginTop: 10 }}>
                    <Note tone="danger">
                      Bu göz bakım kaydı nedeniyle picking'e kapalı. Solver aday
                      kümesinden çıkarıyor.
                    </Note>
                  </div>
                ) : (
                  <p className="text-sm muted" style={{ marginTop: 10 }}>
                    Bu lokasyon mevcut planda değişmiyor.
                  </p>
                )}
              </>
            ) : (
              <div className="rail__empty">
                <h2 className="rail__title">Seçim yapılmadı</h2>
                <p className="text-sm muted" style={{ marginTop: 6 }}>
                  Haritadan bir göz seçin veya aşağıdaki listeden plana giren bir
                  SKU'ya gidin. Klavyeyle harita üzerinde ok tuşlarını
                  kullanabilirsiniz.
                </p>
                <h3 className="section-label" style={{ marginTop: 14 }}>
                  Plandaki ilk öneriler
                </h3>
                <ul className="rail__quicklist">
                  {RECOMMENDATIONS.slice(0, 6).map((rec) => (
                    <li key={rec.skuId}>
                      <button
                        type="button"
                        className="btn btn--quiet btn--sm"
                        onClick={() =>
                          setSelectedLocationId(rec.sourceLocationId)
                        }
                      >
                        <span className="mono">{rec.skuId}</span>
                        <span className="muted">
                          {rec.sourceLocationId} → {rec.targetLocationId}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {selectedRecommendation ? (
            <section className="rail__actions">
              <button
                type="button"
                className="btn btn--block"
                onClick={() =>
                  isLocked
                    ? store.unlock(selectedRecommendation.skuId)
                    : store.lock(
                        selectedRecommendation.skuId,
                        selectedRecommendation.targetLocationId,
                      )
                }
              >
                <Icon name={isLocked ? "unlock" : "lock"} size={14} />
                {isLocked ? "Kilidi kaldır" : "Bu atamayı kilitle"}
              </button>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={() =>
                    store.toggleBlockLocation(
                      selectedRecommendation.targetLocationId,
                    )
                  }
                >
                  <Icon name="ban" size={14} />
                  Bu lokasyonu yasakla
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={() =>
                    store.toggleExclude(selectedRecommendation.skuId)
                  }
                >
                  {isExcluded ? "Plana geri al" : "Plan dışında bırak"}
                </button>
              </div>
              <p className="text-2xs subtle">
                Kilit ve plan dışı kararları bir sonraki "Yeniden optimize et"
                çalıştırmasına kısıt olarak gider.
              </p>
            </section>
          ) : null}
        </aside>
      </div>

      {optimizerOpen ? (
        <OptimizerModal
          planId={plan.id}
          lockedAssignments={store.locks}
          excludedSkuIds={store.excludedSkuIds}
          blockedLocationIds={store.blockedLocationIds}
          onClose={() => setOptimizerOpen(false)}
          onResult={(run) =>
            store.applyRun(run, [
              "net",
              "picking",
              "walking",
              "replenishment",
              "moves",
            ])
          }
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function selectedRecommendationArrows(
  recommendations: typeof RECOMMENDATIONS,
  selectedLocationId: string | null,
  showAll: boolean,
): MoveArrow[] {
  // Harita okla dolmasın: seçim varsa yalnız ilgili ok, seçim yoksa yalnız
  // "Fark" görünümünde bütün oklar çizilir.
  const list = selectedLocationId
    ? recommendations.filter(
        (r) =>
          r.sourceLocationId === selectedLocationId ||
          r.targetLocationId === selectedLocationId,
      )
    : showAll
      ? recommendations
      : [];

  return list.map((r) => ({
    id: `${r.skuId}-arrow`,
    sourceId: r.sourceLocationId,
    targetId: r.targetLocationId,
  }));
}

function LegendSwatch({
  color,
  border,
  label,
  dashed,
}: {
  color: string;
  border: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="row" style={{ gap: 5 }}>
      <span
        aria-hidden="true"
        style={{
          width: 14,
          height: 10,
          background: color,
          border: `1.4px ${dashed ? "dashed" : "solid"} ${border}`,
          borderRadius: 2,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function ComparisonStrip({
  plan,
  flash,
  excludedCount,
}: {
  plan: ReturnType<typeof usePlanStore>["plan"];
  flash: (key: string) => string;
  excludedCount: number;
}) {
  // Önerilen değerler baseline'dan ve plan yüzdesinden türetilir; plan
  // değişince ikisi birlikte güncellenir.
  const project = (baseline: number, deltaPct: number, decimals: number) => {
    const f = 10 ** decimals;
    return Math.round(baseline * (1 + deltaPct / 100) * f) / f;
  };

  const rows = [
    {
      key: "picking",
      label: "Picking süresi",
      current: 71.4,
      proposed: project(71.4, plan.pickingTimeDeltaPct, 1),
      unit: "sn/line",
      decimals: 1,
      delta: plan.pickingTimeDeltaPct,
    },
    {
      key: "walking",
      label: "Yürüyüş",
      current: 128,
      proposed: project(128, plan.walkingDeltaPct, 0),
      unit: "m/pick",
      decimals: 0,
      delta: plan.walkingDeltaPct,
    },
    {
      key: "replenishment",
      label: "Replenishment",
      current: 96,
      proposed: project(96, plan.replenishmentDeltaPct, 0),
      unit: "/gün",
      decimals: 0,
      delta: plan.replenishmentDeltaPct,
    },
  ];

  const max = Math.max(...rows.map((r) => Math.max(r.current, r.proposed)));

  return (
    <div className="compare">
      <div className="compare__head">
        <h2 className="compare__title">Mevcut ve önerilen plan</h2>
        <div className="compare__legend text-xs muted">
          <span className="row" style={{ gap: 5 }}>
            <i style={{ background: "var(--blue-600)" }} /> Mevcut
          </span>
          <span className="row" style={{ gap: 5 }}>
            <i style={{ background: "var(--teal-700)" }} /> Önerilen
          </span>
        </div>
        {excludedCount > 0 ? (
          <span className="text-xs tone-warning">
            {excludedCount} SKU plan dışında bırakıldı
          </span>
        ) : null}
      </div>
      <div className="compare__rows">
        {rows.map((row) => (
          <div className="compare__row" key={row.key}>
            <div className="compare__label">{row.label}</div>
            <div className="compare__bars">
              <div className="compare__bar">
                <span
                  style={{
                    width: `${(row.current / max) * 100}%`,
                    background: "var(--blue-600)",
                  }}
                />
                <em className="mono">{num(row.current, row.decimals)}</em>
              </div>
              <div className="compare__bar">
                <span
                  style={{
                    width: `${(row.proposed / max) * 100}%`,
                    background: "var(--teal-700)",
                  }}
                />
                <em className="mono">{num(row.proposed, row.decimals)}</em>
              </div>
            </div>
            <div className="compare__unit text-2xs subtle">{row.unit}</div>
            <div
              className={`compare__delta mono ${
                row.delta < 0 ? "tone-positive" : "tone-warning"
              }${flash(row.key)}`}
            >
              {pct(row.delta)}
            </div>
          </div>
        ))}
      </div>
      <p className="text-2xs subtle compare__foot">
        Baseline: son 14 vardiya ortalaması · tahmini etki, gerçek WMS verisi
        bağlandığında kalibre edilir · veri güveni {pctPlain(94)}
      </p>
    </div>
  );
}
