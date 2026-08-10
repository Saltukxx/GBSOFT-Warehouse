import type {
  AxleLoadKind,
  LoadExecutionView,
  TruckLoadPlanView,
} from "@gbsoft/domain";

/**
 * Alan adlarının ekrandaki karşılıkları.
 *
 * Sözleşme İngilizce, arayüz Türkçedir; çeviri tek yerde durur ki aynı durum
 * iki ekranda iki farklı kelimeyle görünmesin.
 */

export const STATE_LABEL: Record<TruckLoadPlanView["state"], string> = {
  draft: "Taslak",
  validated: "Sağlıklı",
  rejected: "Kritik",
  published: "Yayınlandı",
};

export const AXLE_KIND_LABEL: Record<AxleLoadKind, string> = {
  "trailer-axle": "Römork dingili",
  coupling: "Kaplin / beşinci teker",
  "tractor-axle": "Çekici dingili",
};

export const EXECUTION_LABEL: Record<LoadExecutionView["state"], string> = {
  "shadow-published": "Shadow hazır",
  loading: "Yükleniyor",
  deviated: "Sapma var",
  completed: "Tamamlandı",
};

export const SCAN_LABEL: Record<
  LoadExecutionView["events"][number]["outcome"],
  string
> = {
  confirmed: "Teyit edildi",
  missing: "Eksik",
  damaged: "Hasarlı",
  "out-of-sequence": "Sıra dışı",
  unknown: "Bilinmeyen kod",
};
