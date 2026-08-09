import type { ImportReport } from "@gbsoft/domain";

/** İçe aktarma sonucunun arayüzdeki karşılığı. */
export const IMPORT_STATUS_LABEL: Record<ImportReport["status"], string> = {
  VALIDATED: "Doğrulandı",
  APPLIED: "Uygulandı",
  REJECTED: "Reddedildi",
};
