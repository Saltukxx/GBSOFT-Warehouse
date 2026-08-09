import type { ImportIssue, ImportReport } from "@gbsoft/domain";
import { MetricStrip, Note, Panel } from "../../components/ui/primitives";
import { DataTable } from "../../components/data-table/DataTable";
import type { Column } from "../../components/data-table/DataTable";
import { IMPORT_STATUS_LABEL } from "./labels";
import { num } from "../../lib/format";

/**
 * İçe aktarma raporu.
 *
 * Hem dosya yükleme ekranı hem layout editörü aynı bileşeni kullanır; ikisi
 * de aynı hattan geçtiği için raporun da aynı görünmesi gerekir.
 */

const DELIMITER_LABEL: Record<string, string> = {
  ";": "noktalı virgül",
  ",": "virgül",
  "\t": "sekme",
};

export function ImportReportPanel({
  report,
  title,
  className,
}: {
  report: ImportReport;
  title?: string;
  className?: string;
}) {
  return (
    <Panel
      title={title ?? `Doğrulama raporu · ${IMPORT_STATUS_LABEL[report.status]}`}
      className={className}
      note={
        report.dryRun
          ? "Kuru koşu — veritabanına yazılmadı."
          : "Kabul edilen satırlar yazıldı."
      }
    >
      <MetricStrip
        metrics={[
          {
            label: "Toplam satır",
            value: num(report.rowsTotal),
            context: `Ayraç: ${DELIMITER_LABEL[report.delimiter] ?? report.delimiter}`,
          },
          {
            label: "Kabul edilen",
            value: num(report.rowsAccepted),
            context: report.dryRun ? "yazılmaya hazır" : "yazıldı",
          },
          {
            label: "Reddedilen",
            value: num(report.rowsRejected),
            deltaTone: report.rowsRejected > 0 ? "negative" : "neutral",
            context: "nedeni aşağıda listelenir",
          },
          {
            label: "Hata / uyarı",
            value: `${num(report.errorCount)} / ${num(report.warningCount)}`,
            context: report.issuesTruncated
              ? `ilk ${report.issues.length} tanesi gösteriliyor`
              : "tamamı gösteriliyor",
          },
        ]}
      />

      {report.summary.length > 0 ? (
        <Note tone={report.errorCount > 0 ? "warning" : "positive"}>
          {report.summary.join(" · ")}
        </Note>
      ) : null}

      {report.status === "REJECTED" ? (
        <Note tone="danger">
          Dosyanın tamamı reddedildi; hiçbir satır yazılmadı. Aşağıdaki
          satırları düzeltip yeniden deneyin.
        </Note>
      ) : null}

      <ImportIssueTable issues={report.issues} />
    </Panel>
  );
}

export function ImportIssueTable({ issues }: { issues: ImportIssue[] }) {
  const columns: Array<Column<ImportIssue & { key: string }>> = [
    {
      key: "line",
      header: "Satır",
      width: 64,
      align: "right",
      cell: (r) => <span className="mono">{r.line === 0 ? "dosya" : r.line}</span>,
      sortValue: (r) => r.line,
    },
    {
      key: "severity",
      header: "Tür",
      width: 76,
      cell: (r) => (
        <span className={r.severity === "error" ? "tone-negative" : "tone-warning"}>
          {r.severity === "error" ? "Hata" : "Uyarı"}
        </span>
      ),
      sortValue: (r) => (r.severity === "error" ? 0 : 1),
    },
    {
      key: "column",
      header: "Kolon",
      width: 130,
      cell: (r) => <span className="mono text-xs">{r.column ?? "—"}</span>,
      sortValue: (r) => r.column ?? "",
    },
    { key: "message", header: "Neden", cell: (r) => r.message },
    {
      key: "value",
      header: "Değer",
      width: 120,
      secondary: true,
      cell: (r) => <span className="mono text-xs">{r.value ?? "—"}</span>,
    },
  ];

  const rows = issues.map((issue, index) => ({
    ...issue,
    key: `${issue.line}:${issue.column ?? ""}:${issue.code}:${index}`,
  }));

  return (
    <DataTable
      caption="Satır bazlı doğrulama sorunları"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      defaultSort={{ key: "line", dir: "asc" }}
      emptyTitle="Sorun bulunamadı."
      emptyHint="Bütün satırlar şablona uyuyor."
    />
  );
}
