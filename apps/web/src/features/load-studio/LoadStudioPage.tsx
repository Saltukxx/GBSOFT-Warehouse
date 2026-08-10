import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type {
  LoadExecutionView,
  LoadInstructionSheet,
  ShipmentDetail,
  ShipmentSummary,
  TruckLoadPlanView,
  VehicleTemplate,
} from "@gbsoft/domain";
import { PageHeader } from "../../components/ui/PageHeader";
import { EmptyState, MetricStrip, Note, Panel, StatusTag } from "../../components/ui/primitives";
import { Icon } from "../../components/ui/Icon";
import { detectWebgl } from "../../components/warehouse-3d/webgl";
import {
  awaitOptimizationRun,
  editLoadPlacement,
  fetchLoadExecution,
  fetchLoadInstructions,
  fetchLoadPlans,
  fetchShipment,
  fetchShipments,
  fetchVehicleTemplates,
  publishLoadPlan,
  reoptimizeLoadPlan,
  scanLoadUnit,
  truckLoadShipment,
} from "../../data/api";
import { useAsync } from "../../lib/useAsync";
import { TruckLoadFootprint2D } from "./TruckLoadFootprint2D";
import { colorForStop } from "./loadColors";
import "./loadstudio.css";

const TruckLoadScene3D = lazy(() =>
  import("../../components/truck-load-3d/TruckLoadScene3D").then((module) => ({
    default: module.TruckLoadScene3D,
  })),
);

type CoordinateDraft = { x: string; y: string; z: string };

const STATE_LABEL: Record<TruckLoadPlanView["state"], string> = {
  draft: "Taslak",
  validated: "Sağlıklı",
  rejected: "Kritik",
  published: "Yayınlandı",
};

const EXECUTION_LABEL: Record<LoadExecutionView["state"], string> = {
  "shadow-published": "Shadow hazır",
  loading: "Yükleniyor",
  deviated: "Sapma var",
  completed: "Tamamlandı",
};

const SCAN_LABEL: Record<LoadExecutionView["events"][number]["outcome"], string> = {
  confirmed: "Teyit edildi",
  missing: "Eksik",
  damaged: "Hasarlı",
  "out-of-sequence": "Sıra dışı",
  unknown: "Bilinmeyen kod",
};

export function LoadStudioPage() {
  const webgl = useMemo(() => detectWebgl(), []);
  const shipments = useAsync<ShipmentSummary[]>((signal) => fetchShipments(signal), []);
  const vehicles = useAsync<VehicleTemplate[]>((signal) => fetchVehicleTemplates(signal), []);
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [vehicleCode, setVehicleCode] = useState("SEMI-13M6");

  useEffect(() => {
    if (shipments.status !== "ready" || shipments.data.length === 0) return;
    if (!shipmentId || !shipments.data.some((shipment) => shipment.id === shipmentId)) {
      setShipmentId(shipments.data[0].id);
    }
  }, [shipments.status, shipments.data, shipmentId]);

  useEffect(() => {
    if (vehicles.status !== "ready" || vehicles.data.length === 0) return;
    if (!vehicles.data.some((vehicle) => vehicle.code === vehicleCode)) {
      setVehicleCode(vehicles.data[0].code);
    }
  }, [vehicles.status, vehicles.data, vehicleCode]);

  const shipment = useAsync<ShipmentDetail | null>(
    (signal) => (shipmentId ? fetchShipment(shipmentId, signal) : Promise.resolve(null)),
    [shipmentId],
  );
  const plans = useAsync<TruckLoadPlanView[]>(
    (signal) => (shipmentId ? fetchLoadPlans(shipmentId, signal) : Promise.resolve([])),
    [shipmentId],
  );

  const [planId, setPlanId] = useState<string | null>(null);
  const [selectedHuCode, setSelectedHuCode] = useState<string | null>(null);
  const [visibleThroughSeq, setVisibleThroughSeq] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sectionView, setSectionView] = useState(true);
  const [scanCode, setScanCode] = useState("");
  const [scanOutcome, setScanOutcome] = useState<"confirmed" | "missing" | "damaged">("confirmed");
  const [draft, setDraft] = useState<CoordinateDraft>({ x: "0", y: "0", z: "0" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "danger" | "positive" | "info" | "warning";
    text: string;
  } | null>(null);

  const plan =
    plans.status === "ready"
      ? plans.data.find((candidate) => candidate.id === planId) ?? plans.data[0] ?? null
      : null;
  const selectedPlacement =
    plan?.placements.find((placement) => placement.unitCode === selectedHuCode) ?? null;
  const maxSeq = useMemo(
    () => Math.max(0, ...(plan?.placements.map((placement) => placement.seq) ?? [0])),
    [plan],
  );
  const execution = useAsync<LoadExecutionView | null>(
    (signal) => (plan ? fetchLoadExecution(plan.id, signal) : Promise.resolve(null)),
    [plan?.id],
  );
  const instructions = useAsync<LoadInstructionSheet | null>(
    () => (plan ? fetchLoadInstructions(plan.id) : Promise.resolve(null)),
    [plan?.id],
  );

  useEffect(() => {
    if (plans.status !== "ready") return;
    if (!plan) {
      setPlanId(null);
      setSelectedHuCode(null);
      return;
    }
    if (plan.id !== planId) setPlanId(plan.id);
  }, [plans.status, plan, planId]);

  useEffect(() => {
    setVisibleThroughSeq(maxSeq);
    setPlaying(false);
    setSelectedHuCode(null);
    setScanCode("");
    setScanOutcome("confirmed");
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
    }, 480);
    return () => window.clearInterval(timer);
  }, [playing, maxSeq]);

  const refresh = useCallback(() => {
    plans.retry();
    shipments.retry();
    execution.retry();
    instructions.retry();
  }, [plans, shipments, execution, instructions]);

  const optimize = useCallback(async () => {
    if (!shipmentId || !vehicleCode) return;
    setBusy(true);
    setMessage(null);
    try {
      const locked =
        plans.status === "ready" &&
        Boolean(plans.data[0]?.placements.some((placement) => placement.locked));
      const started = await truckLoadShipment(shipmentId, {
        vehicleTemplateCode: vehicleCode,
        keepLocked: locked,
      });
      const run = await awaitOptimizationRun(started.runId);
      if (run.status !== "feasible" || run.hardViolations > 0) {
        throw new Error(
          run.infeasibilityReasons?.join(" ") ??
            (run.hardViolations > 0
              ? `Bağımsız doğrulama ${run.hardViolations} kritik ihlal buldu.`
              : `Araç yükleme çözümü ${run.status} durumunda tamamlandı.`),
        );
      }
      setMessage({
        tone: "positive",
        text: locked
          ? "Kilitli yükler korunarak kalan birimler rota sırasına göre yeniden yerleştirildi."
          : "Rota-duyarlı araç planı üretildi ve bağımsız doğrulamadan geçti.",
      });
      refresh();
    } catch (cause) {
      setMessage({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }, [shipmentId, vehicleCode, plans.status, plans.data, refresh]);

  const edit = useCallback(
    async (change: Parameters<typeof editLoadPlacement>[2], success: string) => {
      if (!plan || !selectedPlacement) return;
      setBusy(true);
      setMessage(null);
      try {
        const result = await editLoadPlacement(plan.id, selectedPlacement.unitCode, change);
        setMessage({
          tone: result.state === "validated" ? "positive" : "warning",
          text:
            result.state === "validated"
              ? success
              : "Değişiklik kaydedildi fakat plan güvenlik doğrulamasından geçmedi. İhlalleri inceleyin.",
        });
        plans.retry();
      } catch (cause) {
        setMessage({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
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
    void edit(values, "Yeni konum kaydedildi; araç planı tekrar doğrulandı.");
  };

  const shadowPublish = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    setMessage(null);
    try {
      await publishLoadPlan(plan.id);
      setMessage({
        tone: "positive",
        text: "Plan shadow yürütmeye alındı. Canlı WMS yayını Faz 9 yetki kapısına kadar kapalıdır.",
      });
      refresh();
    } catch (cause) {
      setMessage({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }, [plan, refresh]);

  const submitScan = useCallback(async () => {
    if (!plan || !scanCode.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await scanLoadUnit(plan.id, {
        scannedCode: scanCode.trim(),
        outcome: scanOutcome,
      });
      setScanCode("");
      setMessage({
        tone: result.execution.state === "deviated" ? "warning" : "positive",
        text:
          result.execution.state === "deviated"
            ? "Okutma sapma oluşturdu. Yüklü birimler korunarak yeniden planlama yapılabilir."
            : `${result.execution.loadedCount}/${result.execution.totalCount} yük teyit edildi.`,
      });
      execution.retry();
      shipments.retry();
    } catch (cause) {
      setMessage({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }, [plan, scanCode, scanOutcome, execution, shipments]);

  const deviationReplan = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    setMessage(null);
    try {
      const started = await reoptimizeLoadPlan(plan.id);
      const run = await awaitOptimizationRun(started.runId);
      if (run.status !== "feasible" || run.hardViolations > 0) {
        throw new Error(run.infeasibilityReasons?.join(" ") ?? "Sapma için güvenli plan üretilemedi.");
      }
      setMessage({
        tone: "positive",
        text: `${started.fixedUnitCount} teyitli yük sabitlendi, ${started.excludedUnitCount} sorunlu yük çıkarıldı ve yeni sürüm üretildi.`,
      });
      refresh();
    } catch (cause) {
      setMessage({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }, [plan, refresh]);

  if (shipments.status === "error" || vehicles.status === "error") {
    const error = shipments.status === "error" ? shipments.error : vehicles.status === "error" ? vehicles.error : null;
    return (
      <div className="page">
        <PageHeader eyebrow="Outbound" title="Load Studio" description="Rota-duyarlı 3B araç yükleme." />
        <div className="page__body"><Note tone="danger">Veri yüklenemedi. {error?.message}</Note></div>
      </div>
    );
  }

  const shipmentList = shipments.status === "ready" ? shipments.data : [];
  const vehicleList = vehicles.status === "ready" ? vehicles.data : [];
  const lockedCount = plan?.placements.filter((placement) => placement.locked).length ?? 0;
  const uniqueStops = plan
    ? [...new Map(plan.placements.map((placement) => [placement.stopSeq, placement.stopCode])).entries()].sort(
        ([a], [b]) => a - b,
      )
    : [];

  return (
    <div className="page loadstudio">
      <PageHeader
        eyebrow="Outbound"
        title="Load Studio"
        description="Aracı rota sırasına göre doldurun; aks yükünü, ağırlık merkezini ve her duraktaki erişimi birlikte doğrulayın."
        context={<span className="tag">{webgl.supported ? "3B etkin" : "2B güvenli görünüm"}</span>}
      />

      <div className="page__body loadstudio__layout">
        <aside className="loadstudio__shipments">
          <Panel title="Sevkiyatlar">
            {shipmentList.length === 0 && shipments.status === "ready" ? (
              <EmptyState title="Sevkiyat bulunamadı" hint="Yükleme siparişi oluşturulduğunda burada planlanabilir." />
            ) : (
              <ul className="loadstudio__shipment-list">
                {shipmentList.map((item) => (
                  <li key={item.id}>
                    <button type="button" aria-current={item.id === shipmentId} onClick={() => setShipmentId(item.id)}>
                      <strong>{item.code}</strong>
                      <span>{item.stopCount} durak · {item.unitCount} birim</span>
                      <span>{item.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>

        <div className="loadstudio__main">
          <Panel
            title={shipment.data?.code ? `${shipment.data.code} · araç planı` : "Araç planı"}
            note={shipment.data ? <span className="text-2xs muted">{shipment.data.stops.map((stop) => `${stop.seq}. ${stop.name}`).join(" → ")}</span> : null}
            action={
              shipmentId ? (
                <div className="loadstudio__plan-action">
                  <label>
                    <span>Araç</span>
                    <select value={vehicleCode} disabled={busy} onChange={(event) => setVehicleCode(event.target.value)}>
                      {vehicleList.map((vehicle) => <option key={vehicle.code} value={vehicle.code}>{vehicle.name}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn btn--primary" disabled={busy || vehicleList.length === 0} onClick={optimize}>
                    {busy ? "Çözülüyor…" : lockedCount > 0 ? "Kilitlerle yeniden çöz" : plan ? "Yeni sürüm üret" : "Araç planı oluştur"}
                  </button>
                </div>
              ) : null
            }
          >
            {message ? <Note tone={message.tone}>{message.text}</Note> : null}
            {vehicleList.find((vehicle) => vehicle.code === vehicleCode)?.geometrySource === "golden-assumption" ? (
              <Note tone="warning">Bu araç geometrisi demo varsayımıdır; üretici belgesi veya saha ölçümüyle onaylanmadan canlı yayın yapılamaz.</Note>
            ) : null}
            {plans.status === "error" ? <Note tone="danger">Planlar yüklenemedi. {plans.error.message}</Note> : null}
            {plans.status === "ready" && plans.data.length === 0 ? (
              <EmptyState title="Henüz araç planı yok" hint="Araç planı oluştur düğmesi durak sırasını ve güvenlik limitlerini birlikte uygular." />
            ) : null}
            {plans.status === "ready" && plans.data.length > 0 ? (
              <div className="loadstudio__tabs" role="tablist" aria-label="Plan sürümleri">
                {plans.data.map((candidate, index) => (
                  <button key={candidate.id} type="button" role="tab" aria-selected={candidate.id === plan?.id} onClick={() => setPlanId(candidate.id)}>
                    {index === 0 ? "Güncel" : `v${plans.data.length - index}`}
                    <small>{candidate.vehicle.code} · {candidate.placements.length} birim</small>
                  </button>
                ))}
              </div>
            ) : null}
          </Panel>

          {plan ? (
            <>
              <MetricStrip metrics={[
                { label: "Hacim doluluğu", value: `%${plan.volumeUtilizationPct.toFixed(1)}`, context: "Araç iç hacmine göre." },
                { label: "Toplam yük", value: `${plan.payloadKg.toFixed(1)} kg`, context: `${plan.vehicle.maxPayloadKg.toFixed(0)} kg kapasite.` },
                { label: "Yeniden elleçleme", value: String(plan.rehandlingRiskCount), context: "Durak erişim riski." },
                { label: "Kilitli birim", value: String(lockedCount), context: "Warm-start'ta korunur." },
              ]} />

              <div className="loadstudio__workspace">
                <section className="loadstudio__viewer" aria-label="Araç yükleme görünümü">
                  <div className="loadstudio__viewer-head">
                    <div><strong>{plan.vehicle.name}</strong><span>{plan.vehicle.internalLengthM} × {plan.vehicle.internalWidthM} × {plan.vehicle.internalHeightM} m · arka kapı sağda</span></div>
                    <div className="loadstudio__viewer-actions">
                      <button type="button" className="btn" aria-pressed={sectionView} onClick={() => setSectionView((value) => !value)}>{sectionView ? "Kesit açık" : "Kesit kapalı"}</button>
                      <StatusTag status={STATE_LABEL[plan.state]} />
                    </div>
                  </div>
                  <div className="loadstudio__legend">
                    {uniqueStops.map(([seq, code]) => <span key={seq}><i style={{ background: colorForStop(seq) }} />{seq}. {code}</span>)}
                    <span><i className="loadstudio__cog-dot" />Ağırlık merkezi</span>
                  </div>
                  <div className="loadstudio__stage">
                    {webgl.supported ? (
                      <Suspense fallback={<div className="loadstudio__loading">3B araç hazırlanıyor…</div>}>
                        <TruckLoadScene3D plan={plan} selectedHuCode={selectedHuCode} visibleThroughSeq={visibleThroughSeq} sectionView={sectionView} onSelect={setSelectedHuCode} />
                      </Suspense>
                    ) : (
                      <TruckLoadFootprint2D plan={plan} selectedHuCode={selectedHuCode} visibleThroughSeq={visibleThroughSeq} onSelect={setSelectedHuCode} />
                    )}
                  </div>
                  <div className="loadstudio__replay">
                    <button type="button" className="btn" onClick={() => { if (visibleThroughSeq >= maxSeq) setVisibleThroughSeq(0); setPlaying((value) => !value); }}>
                      {playing ? "Duraklat" : visibleThroughSeq >= maxSeq ? "Baştan oynat" : "Oynat"}
                    </button>
                    <input aria-label="Yükleme sırası" type="range" min={0} max={maxSeq} value={visibleThroughSeq} onChange={(event) => { setPlaying(false); setVisibleThroughSeq(Number(event.target.value)); }} />
                    <span className="mono text-xs">{plan.placements.filter((placement) => placement.seq <= visibleThroughSeq).length}/{plan.placements.length}</span>
                  </div>
                </section>

                <aside className="loadstudio__rail">
                  <Panel title="Aks ve denge" note={<span className="text-2xs muted">Kırmızı nokta: CoG</span>}>
                    <div className="loadstudio__cog">x {plan.centerOfGravity.x.toFixed(2)} · y {plan.centerOfGravity.y.toFixed(2)} · z {plan.centerOfGravity.z.toFixed(2)} m</div>
                    <div className="loadstudio__axles">
                      {plan.axleLoads.map((axle) => (
                        <div key={axle.code}>
                          <span><strong>{axle.code}</strong><small>{axle.totalLoadKg.toFixed(0)} / {axle.maxLoadKg.toFixed(0)} kg</small></span>
                          <div className="loadstudio__bar"><i style={{ width: `${Math.min(100, axle.utilizationPct)}%` }} /></div>
                          <em>%{axle.utilizationPct.toFixed(1)}</em>
                        </div>
                      ))}
                    </div>
                  </Panel>

                  <Panel title="Yerleşim editörü">
                    {selectedPlacement ? (
                      <div className="loadstudio__editor-body">
                        <div className="loadstudio__selected"><div><strong>{selectedPlacement.unitCode}</strong><span>{selectedPlacement.skuCode ?? "Elleçleme birimi"}</span></div>{selectedPlacement.locked ? <StatusTag status="Kilitli" /> : null}</div>
                        <dl className="loadstudio__facts">
                          <div><dt>Durak</dt><dd>{selectedPlacement.stopSeq}. {selectedPlacement.stopCode}</dd></div>
                          <div><dt>Yükleme sırası</dt><dd>{selectedPlacement.seq}</dd></div>
                          <div><dt>Ölçü</dt><dd>{selectedPlacement.lengthM} × {selectedPlacement.widthM} × {selectedPlacement.heightM} m</dd></div>
                          <div><dt>Ağırlık</dt><dd>{selectedPlacement.grossWeightKg.toFixed(1)} kg</dd></div>
                        </dl>
                        <fieldset className="loadstudio__coordinates" disabled={busy || plan.state === "published"}>
                          <legend>Sol-ön-alt koordinat (m)</legend>
                          {(["x", "y", "z"] as const).map((axis) => <label key={axis}><span>{axis.toUpperCase()}</span><input type="number" min={0} step={0.01} value={draft[axis]} onChange={(event) => setDraft((current) => ({ ...current, [axis]: event.target.value }))} /></label>)}
                        </fieldset>
                        <div className="loadstudio__actions">
                          <button type="button" className="btn btn--primary" disabled={busy || plan.state === "published"} onClick={savePosition}>Konumu uygula</button>
                          <button type="button" className="btn" disabled={busy || plan.state === "published"} onClick={() => void edit({ rotateYaw: true }, "Birim araç tabanında 90° döndürüldü.")}>90° döndür</button>
                          <button type="button" className="btn" disabled={busy || plan.state === "published"} onClick={() => void edit({ locked: !selectedPlacement.locked }, selectedPlacement.locked ? "Birim kilidi kaldırıldı." : "Birim yeniden çözme için sabitlendi.")}><Icon name={selectedPlacement.locked ? "unlock" : "lock"} size={14} />{selectedPlacement.locked ? "Kilidi kaldır" : "Yerini kilitle"}</button>
                        </div>
                      </div>
                    ) : <EmptyState title="Bir yük seçin" hint="3B araçta veya yükleme sırasında bir birime tıklayın." />}
                  </Panel>

                  <Panel title="Yükleme sırası" note={<span className="text-2xs muted">Son durak önce</span>}>
                    <ol className="loadstudio__sequence">
                      {[...plan.placements].sort((a, b) => a.seq - b.seq).map((placement) => (
                        <li key={placement.unitCode}><button type="button" aria-current={placement.unitCode === selectedHuCode} onClick={() => { setSelectedHuCode(placement.unitCode); setVisibleThroughSeq(Math.max(visibleThroughSeq, placement.seq)); }}><span>{placement.seq}</span><strong>{placement.unitCode}</strong><small>{placement.stopSeq}. {placement.stopCode}{placement.locked ? " · kilitli" : ""}</small></button></li>
                      ))}
                    </ol>
                  </Panel>
                </aside>
              </div>

              <section className="loadstudio__execution-grid" aria-label="Yükleme execution">
                <Panel
                  title="Shadow execution"
                  note={<span className="text-2xs muted">Canlı WMS yazımı kapalı</span>}
                  action={
                    execution.status === "ready" && execution.data ? (
                      <StatusTag status={EXECUTION_LABEL[execution.data.state]} />
                    ) : null
                  }
                >
                  {execution.status === "ready" && !execution.data ? (
                    <div className="loadstudio__publish-gate">
                      <div>
                        <strong>Plan yürütmeye hazır</strong>
                        <span>Barkod/SSCC teyidi shadow modunda kaydedilir; dış sisteme görev gönderilmez.</span>
                      </div>
                      <button type="button" className="btn btn--primary" disabled={busy || plan.state !== "validated"} onClick={() => void shadowPublish()}>
                        Shadow yayına al
                      </button>
                    </div>
                  ) : null}
                  {execution.status === "ready" && execution.data ? (
                    <div className="loadstudio__execution-body">
                      <div className="loadstudio__execution-kpis">
                        <div><span>Teyit</span><strong>{execution.data.loadedCount}/{execution.data.totalCount}</strong></div>
                        <div><span>Sapma</span><strong>{execution.data.deviationCount}</strong></div>
                        <div><span>Sıradaki</span><strong>{execution.data.nextExpectedCode ?? "Tamamlandı"}</strong></div>
                      </div>
                      {execution.data.state !== "completed" ? (
                        <form className="loadstudio__scan-form" onSubmit={(event) => { event.preventDefault(); void submitScan(); }}>
                          <label>
                            <span>Barkod / SSCC</span>
                            <input autoComplete="off" value={scanCode} onChange={(event) => setScanCode(event.target.value)} placeholder={execution.data.nextExpectedCode ?? "Kod okutun"} />
                          </label>
                          <label>
                            <span>Sonuç</span>
                            <select value={scanOutcome} onChange={(event) => setScanOutcome(event.target.value as typeof scanOutcome)}>
                              <option value="confirmed">Yüklendi</option>
                              <option value="missing">Eksik</option>
                              <option value="damaged">Hasarlı</option>
                            </select>
                          </label>
                          <button type="submit" className="btn btn--primary" disabled={busy || scanCode.trim().length === 0}>Teyit et</button>
                          {execution.data.nextExpectedCode ? (
                            <button type="button" className="btn" disabled={busy} onClick={() => setScanCode(execution.data!.nextExpectedCode ?? "")}>Bekleneni doldur</button>
                          ) : null}
                        </form>
                      ) : <Note tone="positive">Tüm yükler sırasıyla teyit edildi; sevkiyat yüklendi durumuna geçti.</Note>}
                      {execution.data.state === "deviated" ? (
                        <div className="loadstudio__deviation-action">
                          <Note tone="warning">Eksik, hasarlı, bilinmeyen veya sıra dışı okutma tespit edildi.</Note>
                          <button type="button" className="btn btn--primary" disabled={busy || Boolean(execution.data.replacementPlanId)} onClick={() => void deviationReplan()}>
                            {execution.data.replacementPlanId ? "Yeni sürüm üretildi" : "Sapmayı yeniden planla"}
                          </button>
                        </div>
                      ) : null}
                      {execution.data.events.length > 0 ? (
                        <ol className="loadstudio__scan-events">
                          {execution.data.events.map((event) => (
                            <li key={event.id} data-outcome={event.outcome}>
                              <strong>{SCAN_LABEL[event.outcome]}</strong>
                              <span>{event.unitCode ?? event.scannedCode}</span>
                              <small>beklenen #{event.expectedSeq ?? "—"} · okunan #{event.actualSeq ?? "—"}</small>
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </div>
                  ) : null}
                  {execution.status === "error" ? <Note tone="danger">Execution okunamadı. {execution.error.message}</Note> : null}
                </Panel>

                <Panel
                  title="Yükleme talimatı"
                  note={<span className="text-2xs muted">Mobil ve yazdırılabilir</span>}
                  action={<button type="button" className="btn" disabled={instructions.status !== "ready" || !instructions.data} onClick={() => window.print()}>Yazdır</button>}
                >
                  {instructions.status === "ready" && instructions.data ? (
                    <div className="loadstudio__instruction-sheet">
                      <div className="loadstudio__instruction-head">
                        <strong>{instructions.data.planCode}</strong>
                        <span>{instructions.data.shipmentCode} · {instructions.data.vehicleName}</span>
                        <em>SHADOW / SİMÜLASYON</em>
                      </div>
                      <ol>
                        {instructions.data.steps.map((step) => (
                          <li key={step.unitCode}>
                            <span>{step.seq}</span>
                            <div><strong>{step.unitCode}</strong><small>{step.stopSeq}. {step.stopCode} · x {step.position.x.toFixed(2)} / y {step.position.y.toFixed(2)} / z {step.position.z.toFixed(2)} m</small></div>
                            <em>{step.grossWeightKg.toFixed(1)} kg</em>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : instructions.status === "error" ? <Note tone="danger">Talimat üretilemedi. {instructions.error.message}</Note> : <div className="loadstudio__loading">Talimat hazırlanıyor…</div>}
                </Panel>
              </section>

              {plan.violations.length > 0 ? (
                <Panel title={`Doğrulama ihlalleri · ${plan.violations.length}`}><ul className="loadstudio__violations">{plan.violations.map((violation, index) => <li key={`${violation.code}-${index}`}><strong>{violation.code}</strong><span>{violation.message}</span></li>)}</ul></Panel>
              ) : (
                <Note tone="positive">Plan; araç sınırı, kapı, engel, çakışma, toplam/aks yükü, CoG ve durak erişimi kontrollerinden geçti.</Note>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
