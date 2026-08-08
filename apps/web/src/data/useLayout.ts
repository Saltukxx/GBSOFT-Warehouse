import { useMemo } from "react";
import type { FacilityLayout, Location } from "@gbsoft/domain";
import { fetchLayout } from "./api";
import { buildLayers } from "../components/warehouse-map/layers";
import type { LayerDef } from "../components/warehouse-map/layers";
import { useAsync } from "../lib/useAsync";

/**
 * Dijital ikizi yükler.
 *
 * Harita geometrisi, lokasyonlar ve ısı katmanı skalaları buradan gelir;
 * hiçbir bileşen sabit ızgara veya sabit eşik varsaymaz.
 */
export type LayoutState = {
  status: "loading" | "ready" | "error";
  error: Error | null;
  layout: FacilityLayout | null;
  locations: Location[];
  layers: LayerDef[];
  getLocation: (id: string) => Location | undefined;
  retry: () => void;
};

export function useLayout(): LayoutState {
  const state = useAsync((signal) => fetchLayout(signal), []);

  // Referans sabit tutulur; aksi halde aşağıdaki memolar her render'da düşer.
  const locations = useMemo(
    () => state.data?.locations ?? [],
    [state.data],
  );

  const byId = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations],
  );

  const layers = useMemo(() => buildLayers(locations), [locations]);

  return {
    status: state.status,
    error: state.error,
    layout: state.data?.layout ?? null,
    locations,
    layers,
    getLocation: (id: string) => byId.get(id),
    retry: state.retry,
  };
}
