import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LoadExecutionView,
  LoadInstructionSheet,
  ShipmentDetail,
  ShipmentSummary,
  TruckLoadPlanView,
  VehicleTemplate,
} from "@gbsoft/domain";
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
import type { ScanOutcome } from "./ExecutionPanel";
import type { CoordinateDraft } from "./PlanInspector";

/**
 * Load Studio'nun durumu ve eylemleri.
 *
 * Ekranın kuralları burada toplanır, çizim `LoadStudioPage`'de kalır. Ayrımın
 * sebebi uzunluk değil bağlılık: plan üretmek, düzenlemek ve yürütmek aynı
 * sevkiyat/araç seçimine bağlı ve her eylem sonunda aynı yenileme sırasını
 * izliyor — bunu tek bir yerde okumak mümkün olmalı.
 */

export type Message = {
  tone: "danger" | "positive" | "info" | "warning";
  text: string;
};

/** Replay adımları arası bekleme (ms). */
const REPLAY_STEP_MS = 480;

export function useLoadStudio() {
  const shipments = useAsync<ShipmentSummary[]>((signal) => fetchShipments(signal), []);
  const vehicles = useAsync<VehicleTemplate[]>(
    (signal) => fetchVehicleTemplates(signal),
    [],
  );

  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [vehicleCode, setVehicleCode] = useState("SEMI-13M6");
  const [planId, setPlanId] = useState<string | null>(null);
  const [selectedHuCode, setSelectedHuCode] = useState<string | null>(null);
  const [visibleThroughSeq, setVisibleThroughSeq] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sectionView, setSectionView] = useState(true);
  const [scanCode, setScanCode] = useState("");
  const [scanOutcome, setScanOutcome] = useState<ScanOutcome>("confirmed");
  const [draft, setDraft] = useState<CoordinateDraft>({ x: "0", y: "0", z: "0" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    if (shipments.status !== "ready" || shipments.data.length === 0) return;
    const known = shipments.data.some((shipment) => shipment.id === shipmentId);
    if (!shipmentId || !known) setShipmentId(shipments.data[0].id);
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

  const plan =
    plans.status === "ready"
      ? (plans.data.find((candidate) => candidate.id === planId) ??
        plans.data[0] ??
        null)
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

  // Plan değişince görünüm tam yerleşime döner; yarı oynatılmış bir replay
  // yeni planın eksik çizilmesi gibi okunuyordu.
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
    }, REPLAY_STEP_MS);
    return () => window.clearInterval(timer);
  }, [playing, maxSeq]);

  const refresh = useCallback(() => {
    plans.retry();
    shipments.retry();
    execution.retry();
    instructions.retry();
  }, [plans, shipments, execution, instructions]);

  const fail = useCallback((cause: unknown) => {
    setMessage({
      tone: "danger",
      text: cause instanceof Error ? cause.message : String(cause),
    });
  }, []);

  const optimize = useCallback(async () => {
    if (!shipmentId || !vehicleCode) return;
    setBusy(true);
    setMessage(null);
    try {
      // Kilitli poz varsa yeni sürüm warm-start'tır: kullanıcının sabitlediği
      // yükler yerinde kalır, kalanlar yeniden akıtılır.
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
      fail(cause);
    } finally {
      setBusy(false);
    }
  }, [shipmentId, vehicleCode, plans.status, plans.data, refresh, fail]);

  const edit = useCallback(
    async (change: Parameters<typeof editLoadPlacement>[2], success: string) => {
      if (!plan || !selectedPlacement) return;
      setBusy(true);
      setMessage(null);
      try {
        const result = await editLoadPlacement(
          plan.id,
          selectedPlacement.unitCode,
          change,
        );
        // Reddedilen plan silinmez; kullanıcı ihlali görüp geri alabilsin.
        setMessage({
          tone: result.state === "validated" ? "positive" : "warning",
          text:
            result.state === "validated"
              ? success
              : "Değişiklik kaydedildi fakat plan güvenlik doğrulamasından geçmedi. İhlalleri inceleyin.",
        });
        plans.retry();
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    },
    [plan, selectedPlacement, plans, fail],
  );

  const savePosition = useCallback(() => {
    const values = { x: Number(draft.x), y: Number(draft.y), z: Number(draft.z) };
    if (Object.values(values).some((value) => !Number.isFinite(value) || value < 0)) {
      setMessage({
        tone: "danger",
        text: "Koordinatlar sıfır veya pozitif sayı olmalı.",
      });
      return;
    }
    void edit(values, "Yeni konum kaydedildi; araç planı tekrar doğrulandı.");
  }, [draft, edit]);

  const rotate = useCallback(() => {
    void edit({ rotateYaw: true }, "Birim araç tabanında 90° döndürüldü.");
  }, [edit]);

  const toggleLock = useCallback(() => {
    if (!selectedPlacement) return;
    void edit(
      { locked: !selectedPlacement.locked },
      selectedPlacement.locked
        ? "Birim kilidi kaldırıldı."
        : "Birim yeniden çözme için sabitlendi.",
    );
  }, [edit, selectedPlacement]);

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
      fail(cause);
    } finally {
      setBusy(false);
    }
  }, [plan, refresh, fail]);

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
      fail(cause);
    } finally {
      setBusy(false);
    }
  }, [plan, scanCode, scanOutcome, execution, shipments, fail]);

  const deviationReplan = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    setMessage(null);
    try {
      const started = await reoptimizeLoadPlan(plan.id);
      const run = await awaitOptimizationRun(started.runId);
      if (run.status !== "feasible" || run.hardViolations > 0) {
        throw new Error(
          run.infeasibilityReasons?.join(" ") ?? "Sapma için güvenli plan üretilemedi.",
        );
      }
      setMessage({
        tone: "positive",
        text: `${started.fixedUnitCount} teyitli yük sabitlendi, ${started.excludedUnitCount} sorunlu yük çıkarıldı ve yeni sürüm üretildi.`,
      });
      refresh();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }, [plan, refresh, fail]);

  const togglePlay = useCallback(() => {
    if (visibleThroughSeq >= maxSeq) setVisibleThroughSeq(0);
    setPlaying((value) => !value);
  }, [visibleThroughSeq, maxSeq]);

  const seek = useCallback((seq: number) => {
    setPlaying(false);
    setVisibleThroughSeq(seq);
  }, []);

  /** Yükleme sırası listesinden seçim: birim görünür değilse sıra ilerletilir. */
  const selectFromSequence = useCallback(
    (placement: TruckLoadPlanView["placements"][number]) => {
      setSelectedHuCode(placement.unitCode);
      setVisibleThroughSeq((current) => Math.max(current, placement.seq));
    },
    [],
  );

  return {
    shipments,
    vehicles,
    shipment,
    plans,
    execution,
    instructions,
    plan,
    selectedPlacement,
    maxSeq,
    shipmentId,
    vehicleCode,
    selectedHuCode,
    visibleThroughSeq,
    playing,
    sectionView,
    scanCode,
    scanOutcome,
    draft,
    busy,
    message,
    setShipmentId,
    setVehicleCode,
    setPlanId,
    setSelectedHuCode,
    setScanCode,
    setScanOutcome,
    setDraft,
    toggleSection: () => setSectionView((value) => !value),
    togglePlay,
    seek,
    selectFromSequence,
    optimize,
    savePosition,
    rotate,
    toggleLock,
    shadowPublish,
    submitScan,
    deviationReplan,
  };
}
