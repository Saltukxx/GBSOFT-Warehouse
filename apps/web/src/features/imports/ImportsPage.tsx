import { useMemo, useRef, useState } from "react";
import type {
  ImportBatchSummary,
  ImportColumn,
  ImportKind,
  ImportReport,
} from "@gbsoft/domain";
import { PageHeader } from "../../components/ui/PageHeader";
import { Note, Panel, Skeleton } from "../../components/ui/primitives";
import { DataTable } from "../../components/data-table/DataTable";
import type { Column } from "../../components/data-table/DataTable";
import { Icon } from "../../components/ui/Icon";
import {
  DEMO_MODE,
  fetchImportBatches,
  fetchImportTemplates,
  importTemplateUrl,
  uploadImport,
} from "../../data/api";
import { ImportReportPanel } from "./ImportReportPanel";
import { IMPORT_STATUS_LABEL } from "./labels";
import { dateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import "./imports.css";

/**
 * Veri aktarımı — müşteri yok senaryosunun giriş yüzeyi.
 *
 * Akış bilinçli olarak iki adımdır: önce **doğrula**, raporu gör, sonra
 * **uygula**. Tek tıkla yazan bir ekran, hatalı satırı fark etmeden içeri
 * almayı kolaylaştırırdı.
 */

const KIND_ORDER: ImportKind[] = [
  "layout",
  "floor-area",
  "sku",
  "velocity",
  "wave",
  "pick-task",
];

type Selection = { fileName: string; content: string; encodingSuspect: boolean };

export function ImportsPage() {
  const templates = useAsync((signal) => fetchImportTemplates(signal), []);
  const [kind, setKind] = useState<ImportKind>("layout");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<"idle" | "validating" | "applying">("idle");
  const [failure, setFailure] = useState<Error | null>(null);
  const [historyToken, setHistoryToken] = useState(0);
  const [layoutOptions, setLayoutOptions] = useState({
    unitsPerMeter: "7",
    dockAnchorX: "",
    dockAnchorY: "",
    activate: true,
  });

  const history = useAsync((signal) => fetchImportBatches(signal), [historyToken]);
  const fileInput = useRef<HTMLInputElement>(null);

  const template = useMemo(
    () => templates.data?.find((t) => t.kind === kind) ?? null,
    [templates.data, kind],
  );

  function reset() {
    setSelection(null);
    setReport(null);
    setFailure(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onPickFile(file: File) {
    const content = await file.text();
    setSelection({
      fileName: file.name,
      content,
      // U+FFFD, dosyanın UTF-8 olmadığına işarettir: Excel "CSV UTF-8"
      // yerine düz "CSV" ile kaydedilmiş olabilir.
      encodingSuspect: content.includes("�"),
    });
    setReport(null);
    setFailure(null);
  }

  function optionsFor(): Record<string, string> {
    if (kind !== "layout") return {};
    const options: Record<string, string> = {};
    if (layoutOptions.unitsPerMeter.trim())
      options.unitsPerMeter = layoutOptions.unitsPerMeter.trim();
    if (layoutOptions.dockAnchorX.trim())
      options.dockAnchorX = layoutOptions.dockAnchorX.trim();
    if (layoutOptions.dockAnchorY.trim())
      options.dockAnchorY = layoutOptions.dockAnchorY.trim();
    if (layoutOptions.activate) options.activate = "1";
    return options;
  }

  async function run(dryRun: boolean) {
    if (!selection) return;
    setBusy(dryRun ? "validating" : "applying");
    setFailure(null);
    try {
      const result = await uploadImport(
        kind,
        selection.fileName,
        selection.content,
        optionsFor(),
        dryRun,
      );
      setReport(result);
      // Kuru koşular da parti olarak kaydedilir; geçmiş her koşudan sonra
      // tazelenmeli, yoksa panel gerçeği göstermez.
      setHistoryToken((t) => t + 1);
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setBusy("idle");
    }
  }

  const canApply =
    report !== null &&
    report.status === "VALIDATED" &&
    report.rowsAccepted > 0 &&
    !DEMO_MODE;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Sistem"
        title="Veri aktarımı"
        description="Şablonu indirin, doldurun, yükleyin. Yükleme önce doğrular; yazma ayrı ve açık bir adımdır."
        secondaryActions={
          template ? (
            <a
              className="btn"
              href={importTemplateUrl(kind)}
              download={`gbsoft-${kind}.csv`}
            >
              <Icon name="download" size={14} />
              Şablonu indir
            </a>
          ) : null
        }
      />

      {DEMO_MODE ? (
        <Note tone="warning">
          Demo modundasınız. Dosyalar tarayıcıda gerçekten doğrulanır — aynı
          doğrulama motoru — ama veritabanı olmadığı için yazma yapılmaz.
        </Note>
      ) : null}

      <div className="imports">
        {/* --- Şablon seçimi ------------------------------------------- */}
        <Panel title="Veri türü" className="imports__kinds">
          {templates.status === "loading" ? (
            <Skeleton height={220} />
          ) : templates.status === "error" ? (
            <Note tone="danger">
              Şablonlar yüklenemedi: {templates.error.message}
            </Note>
          ) : (
            <ul className="kindlist">
              {KIND_ORDER.map((item) => {
                const entry = templates.data?.find((t) => t.kind === item);
                if (!entry) return null;
                return (
                  <li key={item}>
                    <button
                      type="button"
                      className={`kindlist__item${
                        item === kind ? " kindlist__item--active" : ""
                      }`}
                      aria-pressed={item === kind}
                      onClick={() => {
                        setKind(item);
                        reset();
                      }}
                    >
                      <span className="kindlist__title">{entry.title}</span>
                      <span className="kindlist__meta">
                        {entry.targets.join(" · ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* --- Yükleme -------------------------------------------------- */}
        <Panel title="Dosya" className="imports__upload">
          {template ? (
            <>
              <p className="text-sm">{template.description}</p>

              <div className="imports__rules">
                <span className="tag tag--info">
                  <span className="tag__dot" aria-hidden="true" />
                  {template.rejectPolicy === "all-or-nothing"
                    ? "Tek hata dosyanın tamamını reddeder"
                    : "Hatalı satır atlanır, geçerliler yazılır"}
                </span>
                {template.requires.length > 0 ? (
                  <span className="tag tag--waiting">
                    <span className="tag__dot" aria-hidden="true" />
                    Önce gerekli: {template.requires.join(", ")}
                  </span>
                ) : null}
              </div>

              {kind === "layout" ? (
                <fieldset className="imports__options">
                  <legend>Geometri ayarları</legend>
                  <label>
                    <span>Birim / metre</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={layoutOptions.unitsPerMeter}
                      onChange={(e) =>
                        setLayoutOptions((o) => ({
                          ...o,
                          unitsPerMeter: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Dock X</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="otomatik"
                      value={layoutOptions.dockAnchorX}
                      onChange={(e) =>
                        setLayoutOptions((o) => ({
                          ...o,
                          dockAnchorX: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Dock Y</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="otomatik"
                      value={layoutOptions.dockAnchorY}
                      onChange={(e) =>
                        setLayoutOptions((o) => ({
                          ...o,
                          dockAnchorY: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="imports__check">
                    <input
                      type="checkbox"
                      checked={layoutOptions.activate}
                      onChange={(e) =>
                        setLayoutOptions((o) => ({
                          ...o,
                          activate: e.target.checked,
                        }))
                      }
                    />
                    <span>Yazınca bu sürümü aktif ikiz yap</span>
                  </label>
                </fieldset>
              ) : null}

              <div className="imports__file">
                <input
                  ref={fileInput}
                  id="import-file"
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onPickFile(file);
                  }}
                />
                {selection ? (
                  <span className="mono text-xs">{selection.fileName}</span>
                ) : (
                  <span className="text-xs subtle">Henüz dosya seçilmedi.</span>
                )}
              </div>

              {selection?.encodingSuspect ? (
                <Note tone="warning">
                  Dosyada okunamayan karakter var. Excel'de{" "}
                  <strong>Farklı Kaydet → CSV UTF-8</strong> seçeneğiyle kaydedip
                  tekrar deneyin; aksi halde Türkçe karakterler bozulur.
                </Note>
              ) : null}

              <div className="imports__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!selection || busy !== "idle"}
                  onClick={() => void run(true)}
                >
                  {busy === "validating" ? "Doğrulanıyor…" : "Doğrula"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!canApply || busy !== "idle"}
                  onClick={() => void run(false)}
                  title={
                    canApply
                      ? undefined
                      : "Önce doğrulayın; hatasız satır varsa uygulanabilir."
                  }
                >
                  <Icon name="upload" size={14} />
                  {busy === "applying" ? "Uygulanıyor…" : "Uygula"}
                </button>
                {selection ? (
                  <button type="button" className="btn btn--sm" onClick={reset}>
                    Temizle
                  </button>
                ) : null}
              </div>

              {failure ? <Note tone="danger">{failure.message}</Note> : null}
            </>
          ) : (
            <Skeleton height={160} />
          )}
        </Panel>

        {/* --- Rapor ---------------------------------------------------- */}
        {report ? (
          <ImportReportPanel report={report} className="imports__report" />
        ) : template ? (
          <Panel title="Kolonlar" className="imports__report">
            <ColumnDocs columns={template.columns} />
          </Panel>
        ) : null}

        {/* --- Geçmiş --------------------------------------------------- */}
        <Panel
          title="Yükleme geçmişi"
          className="imports__history"
          note={
            DEMO_MODE ? "Demo modunda geçmiş tutulmaz." : "Kuru koşular da kaydedilir."
          }
        >
          {history.status === "loading" ? (
            <Skeleton height={120} />
          ) : history.status === "error" ? (
            <Note tone="danger">{history.error.message}</Note>
          ) : (
            <HistoryTable batches={history.data ?? []} />
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ColumnDocs({ columns }: { columns: ImportColumn[] }) {
  const tableColumns: Array<Column<ImportColumn>> = [
    {
      key: "name",
      header: "Kolon",
      width: 170,
      cell: (r) => (
        <span className="mono text-xs">
          {r.name}
          {r.required ? <span className="tone-negative"> *</span> : null}
        </span>
      ),
    },
    {
      key: "type",
      header: "Tip",
      width: 110,
      cell: (r) =>
        r.type === "enum" ? (
          <span className="mono text-xs">{r.enumValues?.join(" | ")}</span>
        ) : (
          <span className="text-xs">{TYPE_LABEL[r.type]}</span>
        ),
    },
    { key: "description", header: "Açıklama", cell: (r) => r.description },
    {
      key: "example",
      header: "Örnek",
      width: 110,
      secondary: true,
      cell: (r) => <span className="mono text-xs">{r.example || "—"}</span>,
    },
  ];

  return (
    <>
      <p className="text-xs subtle">
        <span className="tone-negative">*</span> zorunlu. Sayılarda ondalık
        ayraç virgül veya nokta olabilir; ayraç olarak noktalı virgül, virgül
        ve sekme tanınır.
      </p>
      <DataTable
        caption="Şablon kolonları"
        columns={tableColumns}
        rows={columns}
        rowKey={(r) => r.name}
      />
    </>
  );
}

const TYPE_LABEL: Record<ImportColumn["type"], string> = {
  string: "metin",
  number: "sayı",
  integer: "tam sayı",
  boolean: "evet/hayır",
  date: "tarih",
  enum: "seçenek",
};

function HistoryTable({ batches }: { batches: ImportBatchSummary[] }) {
  const columns: Array<Column<ImportBatchSummary>> = [
    {
      key: "createdAt",
      header: "Zaman",
      width: 140,
      cell: (r) => <span className="mono text-xs">{dateTime(r.createdAt)}</span>,
      sortValue: (r) => r.createdAt,
    },
    { key: "kind", header: "Tür", width: 110, cell: (r) => r.kind },
    {
      key: "fileName",
      header: "Dosya",
      cell: (r) => <span className="mono text-xs">{r.fileName}</span>,
    },
    {
      key: "status",
      header: "Sonuç",
      width: 130,
      cell: (r) => (
        <span
          className={
            r.status === "REJECTED"
              ? "tone-negative"
              : r.status === "APPLIED"
                ? "tone-positive"
                : "muted"
          }
        >
          {IMPORT_STATUS_LABEL[r.status]}
          {r.dryRun && r.status !== "REJECTED" ? " (kuru)" : ""}
        </span>
      ),
    },
    {
      key: "rows",
      header: "Kabul / ret",
      width: 110,
      align: "right",
      cell: (r) => (
        <span className="mono text-xs">
          {r.rowsAccepted} / {r.rowsRejected}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption="İçe aktarma geçmişi"
      columns={columns}
      rows={batches}
      rowKey={(r) => r.id}
      defaultSort={{ key: "createdAt", dir: "desc" }}
      emptyTitle="Henüz yükleme yapılmadı."
      emptyHint="Şablonu indirip doldurduktan sonra buradan yükleyin."
    />
  );
}
