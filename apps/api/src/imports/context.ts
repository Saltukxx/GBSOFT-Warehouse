import type { Prisma, PrismaClient } from "@prisma/client";
import type { ImportIssue, ImportRow } from "@gbsoft/domain";

/**
 * İçe aktarma işleyicilerinin ortak bağlamı.
 *
 * İki aşama vardır ve ayrı tutulmaları bilinçlidir:
 *
 *  `check` — veritabanı bağlamı gerektiren kontroller (var olmayan SKU'ya
 *  atıf, kimlik çakışması, dosya içi tekrar). Salt okunurdur; kuru koşuda da
 *  aynen çalışır, bu yüzden kullanıcı "uygula" demeden gerçek sonucu görür.
 *
 *  `apply` — yalnız kabul edilen satırlarla, tek işlem içinde yazma.
 */

export type ImportOptions = Record<string, string>;

export type CheckContext = {
  db: PrismaClient;
  tenantId: string;
  facilityId: string;
  options: ImportOptions;
};

export type ApplyContext = {
  tx: Prisma.TransactionClient;
  tenantId: string;
  facilityId: string;
  options: ImportOptions;
  correlationId: string;
};

export type ApplyOutcome = {
  /** İnsan tarafından okunan sonuç: "1 ikiz sürümü · 96 lokasyon". */
  summary: string[];
  issues: ImportIssue[];
};

export type ImportHandler = {
  check(rows: ImportRow[], ctx: CheckContext): Promise<ImportIssue[]>;
  apply(rows: ImportRow[], ctx: ApplyContext): Promise<ApplyOutcome>;
};

export function error(
  line: number,
  code: string,
  message: string,
  column?: string,
  value?: string,
): ImportIssue {
  return { line, code, message, severity: "error", column, value };
}

export function warning(
  line: number,
  code: string,
  message: string,
  column?: string,
  value?: string,
): ImportIssue {
  return { line, code, message, severity: "warning", column, value };
}

/** Sayısal seçenek okur; verilmemişse veya bozuksa undefined döner. */
export function numberOption(
  options: ImportOptions,
  key: string,
): number | undefined {
  const raw = options[key];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function booleanOption(options: ImportOptions, key: string): boolean {
  const raw = options[key]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "evet";
}

/**
 * Dosya içinde bir anahtarın tekrar etmesini yakalar.
 * İlk görülen satır kabul edilir, sonrakiler reddedilir — sessizce
 * "son yazan kazanır" davranışı bir veri kaybıdır.
 */
export function findDuplicates(
  rows: ImportRow[],
  keyOf: (row: ImportRow) => string | null,
  column: string,
  label: string,
): ImportIssue[] {
  const seen = new Map<string, number>();
  const issues: ImportIssue[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, row.line);
      continue;
    }
    issues.push(
      error(
        row.line,
        "tekrar",
        `${label} dosyada birden çok kez geçiyor (ilk görüldüğü satır: ${first}).`,
        column,
        key,
      ),
    );
  }
  return issues;
}

/**
 * Aynı anahtara bağlı bir alanın satırlar arasında tutarlı olmasını arar.
 * Koridor genişliği gibi tekrar eden değerler dosyanın her satırında aynı
 * olmalıdır; farklıysa hangisinin doğru olduğunu tahmin etmeyiz.
 */
export function findInconsistency(
  rows: ImportRow[],
  keyOf: (row: ImportRow) => string | null,
  valueOf: (row: ImportRow) => string,
  column: string,
  label: string,
): ImportIssue[] {
  const seen = new Map<string, { line: number; value: string }>();
  const issues: ImportIssue[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const value = valueOf(row);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, { line: row.line, value });
      continue;
    }
    if (first.value !== value) {
      issues.push(
        error(
          row.line,
          "tutarsiz",
          `${label} için ${row.line}. satırda "${value}", ` +
            `${first.line}. satırda "${first.value}" yazıyor. İkisi de aynı olmalı.`,
          column,
          value,
        ),
      );
    }
  }
  return issues;
}
