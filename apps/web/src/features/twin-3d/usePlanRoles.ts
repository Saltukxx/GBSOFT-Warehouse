import { useEffect, useState } from "react";
import type { PlanRole } from "../../components/warehouse-3d/sceneColors";
import { fetchPlanVersions, fetchSlotPlan } from "../../data/api";

/**
 * Aktif slot planının göz rolleri — 3B senaryo katmanının verisi.
 *
 * 2B haritadaki `planChange` katmanının karşılığıdır ve aynı kaynaktan okur:
 * `SlotPlan.recommendations[]`. Ayrı bir "değişen gözler" listesi tutmuyoruz;
 * plan neyse rol odur.
 *
 * Katman seçilene kadar hiçbir istek atılmaz — 3B sahneye giren herkesin plan
 * indirmesi için sebep yok.
 */
export type PlanRolesState = {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  error: Error | null;
  planLabel: string | null;
  roles: Map<string, PlanRole>;
  counts: Record<PlanRole, number>;
};

const EMPTY: Map<string, PlanRole> = new Map();

export function usePlanRoles(enabled: boolean): PlanRolesState {
  const [state, setState] = useState<PlanRolesState>({
    status: "idle",
    error: null,
    planLabel: null,
    roles: EMPTY,
    counts: { source: 0, target: 0, unchanged: 0 },
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;

    (async () => {
      setState((previous) => ({ ...previous, status: "loading", error: null }));
      try {
        const plans = await fetchPlanVersions(controller.signal);
        const version = plans.find((item) => item.state === "aktif") ?? plans[0];
        if (!version) {
          if (active) {
            setState({
              status: "empty",
              error: null,
              planLabel: null,
              roles: EMPTY,
              counts: { source: 0, target: 0, unchanged: 0 },
            });
          }
          return;
        }

        const plan = await fetchSlotPlan(version.id, controller.signal);
        if (!active) return;

        const roles = new Map<string, PlanRole>();
        for (const recommendation of plan.recommendations) {
          // Aynı göz hem boşalıp hem dolabilir (zincirli taşıma). Hedef rolü
          // baskın: kullanıcı için önemli olan gözün planda ne olacağıdır.
          if (!roles.has(recommendation.sourceLocationId)) {
            roles.set(recommendation.sourceLocationId, "source");
          }
          roles.set(recommendation.targetLocationId, "target");
        }

        let source = 0;
        let target = 0;
        for (const role of roles.values()) {
          if (role === "source") source += 1;
          else if (role === "target") target += 1;
        }

        setState({
          status: plan.recommendations.length === 0 ? "empty" : "ready",
          error: null,
          planLabel: version.note ? `${version.id} · ${version.note}` : version.id,
          roles,
          counts: { source, target, unchanged: 0 },
        });
      } catch (cause) {
        if (!active) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setState({
          status: "error",
          error: cause instanceof Error ? cause : new Error(String(cause)),
          planLabel: null,
          roles: EMPTY,
          counts: { source: 0, target: 0, unchanged: 0 },
        });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled]);

  return state;
}
