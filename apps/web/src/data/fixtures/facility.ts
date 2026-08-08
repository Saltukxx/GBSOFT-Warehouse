import type { Facility } from "@gbsoft/domain";

/** Kurgusal tesis — §2.1. Bütün ekranlar bu tek kaynaktan beslenir. */
export const FACILITY: Facility = {
  id: "MARMARA-DC-01",
  name: "Marmara Dağıtım Merkezi",
  city: "İstanbul",
  zoneCount: 4,
  aisleCount: 12,
  locationCount: 96,
  skuCount: 184,
  openWaveCount: 38,
  dailyOrderLines: 2840,
  snapshotAt: "2026-08-08T14:32:00+03:00",
  shift: "Vardiya 2",
};

export const CURRENT_USER = {
  name: "Ayşe Yılmaz",
  role: "Depo Müdürü",
  initials: "AY",
};

/** Model ve solver sürümleri — plan lineage'ında görünür. */
export const VERSIONS = {
  model: "pick-time-1.4.2",
  solver: "slot-cp-2.3.0",
  modelUpdatedAt: "13:40",
};
