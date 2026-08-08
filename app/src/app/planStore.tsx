import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";
import type { ReactNode } from "react";
import type { LockedAssignment, ReoptimizeResponse } from "../domain/optimization";
import type { SlotPlan } from "../domain/slotting";
import {
  DEMO_SLOT_PLAN,
  LOCKED_REOPTIMIZED_PLAN,
} from "../data/fixtures/slotPlan";
import { MOVE_TASKS, MOVE_TASKS_R1 } from "../data/fixtures/moveTasks";

/**
 * Plan UI state'i — kilitler, plan dışı bırakılan SKU'lar, yasaklı
 * lokasyonlar, aktif plan sürümü ve yayınlanmış görevler.
 *
 * Domain (server) state'i fixture'lardan gelir; bu store yalnız kullanıcı
 * kararlarını taşır (§16.3).
 */

type State = {
  activePlanId: string;
  locks: LockedAssignment[];
  excludedSkuIds: string[];
  blockedLocationIds: string[];
  publishedTaskIds: string[];
  lastRun: ReoptimizeResponse | null;
  /** Son çalıştırmada değişen KPI anahtarları — 180 ms flash için. */
  changedKeys: string[];
};

type Action =
  | { type: "lock"; skuId: string; locationId: string }
  | { type: "unlock"; skuId: string }
  | { type: "toggleExclude"; skuId: string }
  | { type: "toggleBlockLocation"; locationId: string }
  | { type: "applyRun"; run: ReoptimizeResponse; changedKeys: string[] }
  | { type: "clearChanged" }
  | { type: "publish"; taskIds: string[] }
  | { type: "reset" };

const INITIAL: State = {
  activePlanId: DEMO_SLOT_PLAN.id,
  locks: [],
  excludedSkuIds: [],
  blockedLocationIds: [],
  publishedTaskIds: [],
  lastRun: null,
  changedKeys: [],
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "lock":
      return {
        ...state,
        locks: [
          ...state.locks.filter((l) => l.skuId !== action.skuId),
          { skuId: action.skuId, locationId: action.locationId },
        ],
      };
    case "unlock":
      return {
        ...state,
        locks: state.locks.filter((l) => l.skuId !== action.skuId),
      };
    case "toggleExclude":
      return {
        ...state,
        excludedSkuIds: state.excludedSkuIds.includes(action.skuId)
          ? state.excludedSkuIds.filter((id) => id !== action.skuId)
          : [...state.excludedSkuIds, action.skuId],
      };
    case "toggleBlockLocation":
      return {
        ...state,
        blockedLocationIds: state.blockedLocationIds.includes(action.locationId)
          ? state.blockedLocationIds.filter((id) => id !== action.locationId)
          : [...state.blockedLocationIds, action.locationId],
      };
    case "applyRun":
      return {
        ...state,
        lastRun: action.run,
        activePlanId:
          action.run.status === "feasible" ? action.run.planId : state.activePlanId,
        changedKeys: action.changedKeys,
      };
    case "clearChanged":
      return { ...state, changedKeys: [] };
    case "publish":
      return {
        ...state,
        publishedTaskIds: Array.from(
          new Set([...state.publishedTaskIds, ...action.taskIds]),
        ),
      };
    case "reset":
      return INITIAL;
  }
}

type Store = State & {
  plan: SlotPlan;
  moveTasks: typeof MOVE_TASKS;
  lock: (skuId: string, locationId: string) => void;
  unlock: (skuId: string) => void;
  toggleExclude: (skuId: string) => void;
  toggleBlockLocation: (locationId: string) => void;
  applyRun: (run: ReoptimizeResponse, changedKeys: string[]) => void;
  clearChanged: () => void;
  publish: (taskIds: string[]) => void;
  reset: () => void;
  isLocked: (skuId: string) => boolean;
};

const PlanContext = createContext<Store | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const plan =
    state.activePlanId === LOCKED_REOPTIMIZED_PLAN.id
      ? LOCKED_REOPTIMIZED_PLAN
      : DEMO_SLOT_PLAN;

  const moveTasks =
    state.activePlanId === LOCKED_REOPTIMIZED_PLAN.id ? MOVE_TASKS_R1 : MOVE_TASKS;

  const lock = useCallback(
    (skuId: string, locationId: string) =>
      dispatch({ type: "lock", skuId, locationId }),
    [],
  );
  const unlock = useCallback(
    (skuId: string) => dispatch({ type: "unlock", skuId }),
    [],
  );
  const toggleExclude = useCallback(
    (skuId: string) => dispatch({ type: "toggleExclude", skuId }),
    [],
  );
  const toggleBlockLocation = useCallback(
    (locationId: string) => dispatch({ type: "toggleBlockLocation", locationId }),
    [],
  );
  const applyRun = useCallback(
    (run: ReoptimizeResponse, changedKeys: string[]) =>
      dispatch({ type: "applyRun", run, changedKeys }),
    [],
  );
  const clearChanged = useCallback(() => dispatch({ type: "clearChanged" }), []);
  const publish = useCallback(
    (taskIds: string[]) => dispatch({ type: "publish", taskIds }),
    [],
  );
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  const value = useMemo<Store>(
    () => ({
      ...state,
      plan,
      moveTasks,
      lock,
      unlock,
      toggleExclude,
      toggleBlockLocation,
      applyRun,
      clearChanged,
      publish,
      reset,
      isLocked: (skuId: string) => state.locks.some((l) => l.skuId === skuId),
    }),
    [
      state,
      plan,
      moveTasks,
      lock,
      unlock,
      toggleExclude,
      toggleBlockLocation,
      applyRun,
      clearChanged,
      publish,
      reset,
    ],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlanStore(): Store {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlanStore must be used inside PlanProvider");
  return ctx;
}
