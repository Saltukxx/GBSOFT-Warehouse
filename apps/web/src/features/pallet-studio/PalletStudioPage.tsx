import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  PalletPlanView,
  ShipmentDetail,
  ShipmentSummary,
} from "@gbsoft/domain";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  EmptyState,
  MetricStrip,
  Note,
  Panel,
  StatusTag,
} from "../../components/ui/primitives";
import { Icon } from "../../components/ui/Icon";
import { detectWebgl } from "../../components/warehouse-3d/webgl";
import {
  awaitOptimizationRun,
  editPalletPlacement,
  fetchPalletPlans,
  fetchShipment,
  fetchShipments,
  palletizeShipment,
} from "../../data/api";
import { useAsync } from "../../lib/useAsync";
import { PalletFootprint2D } from "./PalletFootprint2D";
import "./palletstudio.css";

const PalletScene3D = lazy(() =>
  import("../../components/pallet-3d/PalletScene3D").then((module) => ({
    default: module.PalletScene3D,
  })),
);

type CoordinateDraft = { x: string; y: string; z: string };

const STATE_LABEL: Record<PalletPlanView["state"], string> = {
  draft: "Taslak",
  validated: "Sağlıklı",
  rejected: "Kritik",
  published: "Yayınlandı",
};

export function PalletStudioPage() {
  const webgl = useMemo(() => detectWebgl(), []);
  const shipments = useAsync<ShipmentSummary[]>((signal) => fetchShipments(signal), []);
  const [shipmentId, setShipmentId] = useState<string | null>(null);

  useEffect(() => {
    if (shipments.status !== "ready" || shipments.data.length === 0) return;
    if (!shipmentId || !shipments.data.some((shipment) => shipment.id === shipmentId)) {
      setShipmentId(shipments.data[0].id);
    }
  }, [shipments.status, shipments.data, shipmentId]);

  const shipment = useAsync<ShipmentDetail | null>(
    (signal) =>
      shipmentId ? fetchShipment(shipmentId, signal) : Promise.resolve(null),
    [shipmentId],
  );
  const plans = useAsync<PalletPlanView[]>(
    (signal) =>
      shipmentId ? fetchPalletPlans(shipmentId, signal) : Promise.resolve([]),
    [shipmentId],
  );

  const [planId, setPlanId] = useState<string | null>(null);
  const [selectedHuCode, setSelectedHuCode] = useState<string | null>(null);
  const [visibleThroughSeq, setVisibleThroughSeq] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [draft, setDraft] = useState<CoordinateDraft>({ x: "0", y: "0", z: "0" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "positive" | "info"; text: string } | null>(null);

  const plan =
    plans.status === "ready"
      ? plans.data.find((candidate) => candidate.id === planId) ?? plans.data[0] ?? null
      : null;
  const maxSeq = useMemo(
    () => Math.max(0, ...(plan?.placements.map((placement) => placement.seq) ?? [0])),
    [plan],
  );
  const selectedPlacement =
    plan?.placements.find((placement) => placement.huCode === selectedHuCode) ?? null;

  useEffect(() => {
    if (!plan) {
      setPlanId(null);
      setSelectedHuCode(null);
      return;
    }
    if (plan.id !== planId) setPlanId(plan.id);
  }, [plan, planId]);

  useEffect(() => {
    setVisibleThroughSeq(maxSeq);
    setPlaying(false);
    setSelectedHuCode(null);
  }, [plan?.id, maxSeq]);

  useEffect(() => {
    if (!selectedPlacement) return;
    setDraft({
      x: selectedPlacement.x.toFixed(3),
      y: selectedPlacement.y.toFixed(3),
      z: selectedPlacement.z.toFixed(3),
    });
  }, [selectedPlacement]);

  useEffect(() => {
    if (!playing || maxSeq === 0) return;
    const timer = window.setInterval(() => {
      setVisibleThroughSeq((current) => {
        if (current >= maxSeq) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 550);
    return () => window.clearInterval(timer);
  }, [playing, maxSeq]);

  const refresh = useCallback(() => {
    plans.retry();
    shipments.retry();
  }, [plans, shipments]);

  const optimize = useCallback(async () => {
    if (!shipmentId) return;
    setBusy(true);
    setMessage(null);
    try {
      const locked =
        plans.status === "ready" &&
        plans.data.some((candidate) =>
          candidate.placements.some((placement) => placement.locked),
        );
      const started = await palletizeShipment(shipmentId, { keepLocked: locked });
      const run = await awaitOptimizationRun(started.runId);
      if (run.status !== "feasible") {
        throw new Error(
          run.infeasibilityReasons?.join(" ") ??
            `Palet çözümü ${run.status} durumunda tamamlandı.`,
        );
      }
      setMessage({
        tone: "positive",
        text: locked
          ? "Kilitli birimler korunarak kalan yükler yeniden yerleştirildi."
          : "Palet planı üretildi ve bağımsız doğrulamadan geçirildi.",
      });
      refresh();
    } catch (cause) {
      setMessage({
        tone: "danger",
        text: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  }, [shipmentId, plans.status, plans.data, refresh]);

  const edit = useCallback(
    async (change: Parameters<typeof editPalletPlacement>[2], success: string) => {
      if (!plan || !selectedPlacement) return;
      setBusy(true);
      setMessage(null);
      try {
        await editPalletPlacement(plan.id, selectedPlacement.huCode, change);
        setMessage({ tone: "positive", text: success });
        plans.retry();
      } catch (cause) {
        setMessage({
          tone: "danger",
          text: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        setBusy(false);
      }
    },
    [plan, selectedPlacement, plans],
  );

  const savePosition = () => {
    const values = { x: Number(draft.x), y: Number(draft.y), z: Number(draft.z) };
    if (Object.values(values).some((value) => !Number.isFinite(value) || value < 0)) {
      setMessage({ tone: "danger", text: "Koordinatlar sıfır veya pozitif sayı olmalı." });
      return;
    }
    void edit(values, "Yeni konum kaydedildi; palet tekrar doğrulandı.");
  };

  if (shipments.status === "error") {
    return (
      <div className="page">
        <PageHeader eyebrow="Outbound" title="Palet Studio" description="3B palet planlama ve doğrulama." />
        <div className="page__body">
          <Note tone="danger">Sevkiyatlar yüklenemedi. {shipments.error.message}</Note>
        </div>
      </div>
    );
  }

  const shipmentList = shipments.status === "ready" ? shipments.data : [];
  const lockedCount = plan?.placements.filter((placement) => placement.locked).length ?? 0;

  return (
    <div className="page palletstudio">
      <PageHeader
        eyebrow="Outbound"
        title="Palet Studio"
        description="Yükleri üç boyutlu inceleyin, yerleşimi düzenleyin ve güvenlik doğrulamasını anında görün."
        context={
          <span className="tag">
            {webgl.supported ? "3B etkin" : "2B güvenli görünüm"}
          </span>
        }
      />

      <div className="page__body palletstudio__layout">
        <aside className="palletstudio__shipments">
          <Panel title="Sevkiyatlar">
            {shipmentList.length === 0 && shipments.status === "ready" ? (
              <EmptyState
                title="Sevkiyat bulunamadı"
                hint="Bir sevkiyat oluşturulduğunda palet planı burada hazırlanabilir."
              />
            ) : (
              <ul className="palletstudio__shipment-list">
                {shipmentList.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={item.id === shipmentId}
                      onClick={() => setShipmentId(item.id)}
                    >
                      <strong>{item.code}</strong>
                      <span>{item.stopCount} durak · {item.unitCount} birim</span>
                      <span>{item.palletCount} palet</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>

        <div className="palletstudio__main">
          <Panel
            title={shipment.data?.code ? `${shipment.data.code} · palet planı` : "Palet planı"}
            note={
              shipment.data ? (
                <span className="text-2xs muted">
                  {shipment.data.stops.map((stop) => `${stop.seq}. ${stop.name}`).join(" → ")}
                </span>
              ) : null
            }
            action={
              shipmentId ? (
                <button type="button" className="btn btn--primary" disabled={busy} onClick={optimize}>
                  {busy ? "Çözülüyor…" : lockedCount > 0 ? "Kilitlerle yeniden çöz" : plan ? "Planı yeniden üret" : "Palet planı oluştur"}
                </button>
              ) : null
            }
          >
            {message ? <Note tone={message.tone}>{message.text}</Note> : null}
            {plans.status === "error" ? (
              <Note tone="danger">Palet planları yüklenemedi. {plans.error.message}</Note>
            ) : null}
            {plans.status === "ready" && plans.data.length === 0 ? (
              <EmptyState
                title="Henüz palet planı yok"
                hint="Palet planı oluştur düğmesi sevkiyat birimlerini fiziksel kurallarla yerleştirir."
              />
            ) : null}

            {plans.status === "ready" && plans.data.length > 0 ? (
              <div className="palletstudio__tabs" role="tablist" aria-label="Paletler">
                {plans.data.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    role="tab"
                    aria-selected={candidate.id === plan?.id}
                    onClick={() => setPlanId(candidate.id)}
                  >
                    {candidate.code}
                    <small>{candidate.placements.length} birim</small>
                  </button>
                ))}
              </div>
            ) : null}
          </Panel>

          {plan ? (
            <>
              <MetricStrip
                metrics={[
                  { label: "Hacim doluluğu", value: `%${plan.volumeUtilizationPct.toFixed(1)}`, context: "Kullanılabilir yük zarfına göre." },
                  { label: "Taban doluluğu", value: `%${plan.footprintUtilizationPct.toFixed(1)}`, context: "Güverteye oturan alan." },
                  { label: "Yük", value: `${plan.usedWeightKg.toFixed(1)} kg`, context: `${plan.base.maxWeightKg.toFixed(0)} kg kapasite.` },
                  { label: "Yükseklik", value: `${(plan.usedHeightM + plan.base.deckHeightM).toFixed(2)} m`, context: `${plan.base.maxHeightM.toFixed(2)} m sınır.` },
                ]}
              />

              <div className="palletstudio__workspace">
                <section className="palletstudio__viewer" aria-label="Palet görünümü">
                  <div className="palletstudio__viewer-head">
                    <div>
                      <strong>{plan.code}</strong>
                      <span>{plan.base.packageTypeName} · {plan.base.lengthM} × {plan.base.widthM} m</span>
                    </div>
                    <StatusTag status={STATE_LABEL[plan.state]} />
                  </div>
                  <div className="palletstudio__stage">
                    {webgl.supported ? (
                      <Suspense fallback={<div className="palletstudio__loading">3B sahne hazırlanıyor…</div>}>
                        <PalletScene3D
                          plan={plan}
                          selectedHuCode={selectedHuCode}
                          visibleThroughSeq={visibleThroughSeq}
                          onSelect={setSelectedHuCode}
                        />
                      </Suspense>
                    ) : (
                      <PalletFootprint2D
                        plan={plan}
                        selectedHuCode={selectedHuCode}
                        visibleThroughSeq={visibleThroughSeq}
                        onSelect={setSelectedHuCode}
                      />
                    )}
                  </div>
                  <div className="palletstudio__replay">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (visibleThroughSeq >= maxSeq) setVisibleThroughSeq(0);
                        setPlaying((value) => !value);
                      }}
                    >
                      {playing ? "Duraklat" : visibleThroughSeq >= maxSeq ? "Baştan oynat" : "Oynat"}
                    </button>
                    <input
                      aria-label="Yerleştirme sırası"
                      type="range"
                      min={0}
                      max={maxSeq}
                      value={visibleThroughSeq}
                      onChange={(event) => {
                        setPlaying(false);
                        setVisibleThroughSeq(Number(event.target.value));
                      }}
                    />
                    <span className="mono text-xs">{plan.placements.filter((p) => p.seq <= visibleThroughSeq).length}/{plan.placements.length}</span>
                  </div>
                </section>

                <aside className="palletstudio__editor">
                  <Panel title="Yerleşim editörü">
                    {selectedPlacement ? (
                      <div className="palletstudio__editor-body">
                        <div className="palletstudio__selected">
                          <div>
                            <strong>{selectedPlacement.huCode}</strong>
                            <span>{selectedPlacement.skuCode ?? selectedPlacement.packageTypeCode}</span>
                          </div>
                          {selectedPlacement.locked ? <StatusTag status="Kilitli" /> : null}
                        </div>
                        <dl className="palletstudio__facts">
                          <div><dt>Durak</dt><dd>{selectedPlacement.stopCode ?? "—"}</dd></div>
                          <div><dt>Sıra / katman</dt><dd>{selectedPlacement.seq} / {selectedPlacement.layer}</dd></div>
                          <div><dt>Ölçü</dt><dd>{selectedPlacement.lengthM} × {selectedPlacement.widthM} × {selectedPlacement.heightM} m</dd></div>
                          <div><dt>Ağırlık</dt><dd>{selectedPlacement.grossWeightKg.toFixed(1)} kg</dd></div>
                        </dl>
                        <fieldset className="palletstudio__coordinates" disabled={busy}>
                          <legend>Sol-ön-alt koordinat (m)</legend>
                          {(["x", "y", "z"] as const).map((axis) => (
                            <label key={axis}>
                              <span>{axis.toUpperCase()}</span>
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={draft[axis]}
                                onChange={(event) => setDraft((current) => ({ ...current, [axis]: event.target.value }))}
                              />
                            </label>
                          ))}
                        </fieldset>
                        <div className="palletstudio__actions">
                          <button type="button" className="btn btn--primary" disabled={busy} onClick={savePosition}>Konumu uygula</button>
                          <button type="button" className="btn" disabled={busy} onClick={() => void edit({ rotateYaw: true }, "Birim yatay eksende döndürüldü.")}>90° döndür</button>
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() => void edit(
                              { locked: !selectedPlacement.locked },
                              selectedPlacement.locked ? "Birim kilidi kaldırıldı." : "Birim yeniden çözme için sabitlendi.",
                            )}
                          >
                            <Icon name={selectedPlacement.locked ? "unlock" : "lock"} size={14} />
                            {selectedPlacement.locked ? "Kilidi kaldır" : "Yerini kilitle"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <EmptyState title="Bir yük seçin" hint="3B sahnede veya yükleme sırasında bir kutuya tıklayın." />
                    )}
                  </Panel>

                  <Panel title="Yükleme sırası" note={<span className="text-2xs muted">Alt destekler önce</span>}>
                    <ol className="palletstudio__sequence">
                      {[...plan.placements].sort((a, b) => a.seq - b.seq).map((placement) => (
                        <li key={placement.huCode}>
                          <button
                            type="button"
                            aria-current={placement.huCode === selectedHuCode}
                            onClick={() => {
                              setSelectedHuCode(placement.huCode);
                              setVisibleThroughSeq(Math.max(visibleThroughSeq, placement.seq));
                            }}
                          >
                            <span>{placement.seq}</span>
                            <strong>{placement.huCode}</strong>
                            <small>{placement.stopCode ?? "Durak yok"}{placement.locked ? " · kilitli" : ""}</small>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </Panel>
                </aside>
              </div>

              {plan.violations.length > 0 ? (
                <Panel title={`Doğrulama ihlalleri · ${plan.violations.length}`}>
                  <ul className="palletstudio__violations">
                    {plan.violations.map((violation, index) => (
                      <li key={`${violation.code}-${index}`}>
                        <strong>{violation.code}</strong>
                        <span>{violation.message}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : (
                <Note tone="positive">Plan; sınır, çakışma, destek, istif, ağırlık merkezi ve yükleme sırası kontrollerinden geçti.</Note>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
