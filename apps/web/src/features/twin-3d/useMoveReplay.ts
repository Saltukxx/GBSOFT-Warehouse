import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MoveTask, PlanVersion, RoutePlan, Vec3 } from "@gbsoft/domain";
import { fetchMoveTasks, fetchPlanVersions, fetchRoute } from "../../data/api";

/**
 * Move-task rotalarının 3B replay'i (Faz 6.3).
 *
 * Rota tarayıcıda uydurulmaz: duraklar plan görevlerinden çıkar, güzergâh
 * `/api/facilities/:code/routes` üzerinden **kalıcı yürüyüş grafından** gelir.
 * Bu yüzden replay'de görülen yol ile mesafe matrisi aynı sayıyı söyler.
 *
 * Bir görev şu iki bacaktan oluşur: taşıyıcı önce kaynak göze gider, sonra
 * yükü hedef göze taşır. Zincir dock'tan başlar ve dock'ta biter.
 */

export type ReplayStep = {
  taskCode: string;
  label: string;
  fromCode: string;
  toCode: string;
  distanceM: number;
  points: Vec3[];
};

export type ReplayState = {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  error: Error | null;
  planLabel: string | null;
  steps: ReplayStep[];
  totalDistanceM: number;
  /** Grafta çözülemeyen bacaklar — sessizce yutulmaz. */
  unreachable: RoutePlan["unreachable"];
  stepIndex: number;
  progress: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  reset: () => void;
  setStepIndex: (index: number) => void;
  setProgress: (value: number) => void;
  load: () => void;
};

/** Bir bacağın oynatılma süresi; 1 m ≈ 60 ms, en az yarım saniye. */
function durationMs(distanceM: number): number {
  return Math.max(500, distanceM * 60);
}

/**
 * Plan etiketi. `PlanVersion` bir plan **kodu** taşımaz, kimlik taşır; `note`
 * ise solver/model sürümlerini içeren uzun bir metindir ve dar panele sığmaz.
 * Kimlik yeterli — sürüm ayrıntısı Plan geçmişi ekranında zaten var.
 */
function planLabelFor(plan: PlanVersion): string {
  return plan.id;
}

export function useMoveReplay(): ReplayState {
  const [status, setStatus] = useState<ReplayState["status"]>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [planLabel, setPlanLabel] = useState<string | null>(null);
  const [steps, setSteps] = useState<ReplayStep[]>([]);
  const [unreachable, setUnreachable] = useState<RoutePlan["unreachable"]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (token === 0) return;
    const controller = new AbortController();
    let active = true;

    (async () => {
      setStatus("loading");
      setError(null);
      try {
        const plans = await fetchPlanVersions(controller.signal);
        // Liste sırası aktif planı garanti etmiyor; durumu açıkça arıyoruz.
        const plan = plans.find((item) => item.state === "aktif") ?? plans[0];
        if (!plan) {
          if (active) {
            setStatus("empty");
            setSteps([]);
          }
          return;
        }

        const tasks = await fetchMoveTasks(plan.id, controller.signal);
        const moves = tasks.filter(
          (task: MoveTask) => task.sourceLocationId && task.targetLocationId,
        );
        if (moves.length === 0) {
          if (active) {
            setPlanLabel(planLabelFor(plan));
            setStatus("empty");
            setSteps([]);
          }
          return;
        }

        // Duraklar: dock → (kaynak → hedef)* → dock.
        const stops = ["DOCK"];
        for (const task of moves) {
          stops.push(task.sourceLocationId!, task.targetLocationId!);
        }
        stops.push("DOCK");

        const route = await fetchRoute(stops, controller.signal);
        if (!active) return;

        // Bacakları görev etiketleriyle eşleştir: her görev bir "git" ve bir
        // "taşı" bacağı üretir.
        // Görev etiketi zaten "SKU-184 taşı" gibi bir eylem içerir; onu bacak
        // eylemiyle birleştirmek "taşı — taşı" üretiyordu. SKU kodu varsa onu
        // kullanıyoruz, yoksa etikete düşüyoruz.
        const nameOf = (task: MoveTask) => task.skuId ?? task.label;
        const labelFor = (fromCode: string, toCode: string): string => {
          const carrying = moves.find(
            (task) =>
              task.sourceLocationId === fromCode && task.targetLocationId === toCode,
          );
          if (carrying) return `${nameOf(carrying)} · ${fromCode} → ${toCode} taşı`;
          const approaching = moves.find((task) => task.sourceLocationId === toCode);
          if (approaching) return `${nameOf(approaching)} · ${toCode} gözüne git`;
          return toCode === "DOCK" ? "Dock'a dön" : `${toCode} gözüne git`;
        };

        setPlanLabel(planLabelFor(plan));
        setUnreachable(route.unreachable);
        setSteps(
          route.legs.map((leg, index) => ({
            taskCode: `${index + 1}`,
            label: labelFor(leg.fromCode, leg.toCode),
            fromCode: leg.fromCode,
            toCode: leg.toCode,
            distanceM: leg.distanceM,
            points: leg.points,
          })),
        );
        setStepIndex(0);
        setProgress(0);
        setStatus("ready");
      } catch (cause) {
        if (!active) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setStatus("error");
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [token]);

  /* --- Oynatma ------------------------------------------------------- */
  const frameRef = useRef<number | null>(null);
  const startedRef = useRef<{ time: number; from: number } | null>(null);

  useEffect(() => {
    if (!playing || steps.length === 0) return;

    const step = steps[Math.min(stepIndex, steps.length - 1)];
    const total = durationMs(step.distanceM);
    startedRef.current = { time: performance.now(), from: progress };

    const tick = () => {
      const started = startedRef.current;
      if (!started) return;
      const elapsed = performance.now() - started.time;
      const next = started.from + elapsed / total;

      if (next >= 1) {
        if (stepIndex >= steps.length - 1) {
          setProgress(1);
          setPlaying(false);
          return;
        }
        setStepIndex((index) => index + 1);
        setProgress(0);
        return;
      }

      setProgress(next);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
    // `progress` bilerek dışarıda: her karede efekt yeniden kurulmamalı.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stepIndex, steps]);

  const totalDistanceM = useMemo(
    () => Math.round(steps.reduce((sum, step) => sum + step.distanceM, 0) * 10) / 10,
    [steps],
  );

  const reset = useCallback(() => {
    setPlaying(false);
    setStepIndex(0);
    setProgress(0);
  }, []);

  return {
    status,
    error,
    planLabel,
    steps,
    totalDistanceM,
    unreachable,
    stepIndex,
    progress,
    playing,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    reset,
    setStepIndex: (index: number) => {
      setPlaying(false);
      setStepIndex(index);
      setProgress(0);
    },
    setProgress,
    load: () => setToken((value) => value + 1),
  };
}
