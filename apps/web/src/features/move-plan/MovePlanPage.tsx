import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Note, StatusTag } from "../../components/ui/primitives";
import { Icon } from "../../components/ui/Icon";
import { DataTable } from "../../components/data-table/DataTable";
import type { Column } from "../../components/data-table/DataTable";
import { usePlanStore } from "../../app/planStore";
import type { MoveTask } from "@gbsoft/domain";
import type { ZoneId } from "@gbsoft/domain";
import { PACKAGE_LABELS, taskSkuName } from "@gbsoft/seed";
import { publishMoveTasks } from "../../data/api";
import { hours, num, pct } from "../../lib/format";
import "./moveplan.css";

type ZoneOption = ZoneId | "all";
type StatusOption = "all" | "hazır" | "bekliyor" | "yayınlandı";

export function MovePlanPage() {
  const store = usePlanStore();
  const { plan, moveTasks } = store;

  const [zone, setZone] = useState<ZoneOption>("all");
  const [statusFilter, setStatusFilter] = useState<StatusOption>("all");
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishedMessage, setPublishedMessage] = useState<string | null>(null);

  const tasksWithStatus = useMemo(
    () =>
      moveTasks.map((t) =>
        store.publishedTaskIds.includes(t.id)
          ? { ...t, status: "yayınlandı" as const }
          : t,
      ),
    [moveTasks, store.publishedTaskIds],
  );

  const visible = useMemo(
    () =>
      tasksWithStatus.filter(
        (t) =>
          (zone === "all" || t.zone === zone) &&
          (statusFilter === "all" || t.status === statusFilter),
      ),
    [tasksWithStatus, zone, statusFilter],
  );

  const selectedTask =
    selectedSeq !== null
      ? (tasksWithStatus.find((t) => t.seq === selectedSeq) ?? null)
      : null;

  const selection = useMemo(
    () => tasksWithStatus.filter((t) => checked.has(t.seq)),
    [tasksWithStatus, checked],
  );

  const selectionHours =
    Math.round(selection.reduce((sum, t) => sum + t.loadHours, 0) * 10) / 10;
  const selectionBenefit =
    Math.round(selection.reduce((sum, t) => sum + t.expectedBenefitPct, 0) * 10) /
    10;
  const selectionPackages = useMemo(
    () => new Set(selection.map((t) => t.packageId)),
    [selection],
  );

  /** Bağımlılık paketi bütünlüğü: seçim, paketin tamamını kapsamalıdır. */
  const incompletePackages = useMemo(() => {
    const out: string[] = [];
    for (const pkg of selectionPackages) {
      const all = tasksWithStatus.filter((t) => t.packageId === pkg);
      const picked = all.filter((t) => checked.has(t.seq));
      if (picked.length !== all.length) out.push(pkg);
    }
    return out;
  }, [selectionPackages, tasksWithStatus, checked]);

  function toggleTask(seq: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }

  function selectZoneA(select: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const t of tasksWithStatus) {
        if (t.zone !== "A") continue;
        if (select) next.add(t.seq);
        else next.delete(t.seq);
      }
      return next;
    });
  }

  const zoneAllChecked =
    tasksWithStatus.filter((t) => t.zone === "A").length > 0 &&
    tasksWithStatus
      .filter((t) => t.zone === "A")
      .every((t) => checked.has(t.seq));

  async function publish() {
    setPublishing(true);
    const result = await publishMoveTasks(
      plan.id,
      selection.map((t) => t.id),
    );
    store.publish(selection.map((t) => t.id));
    setPublishedMessage(
      `Demo modunda ${result.published} görev yayınlandı`,
    );
    setChecked(new Set());
    setPublishing(false);
  }

  const columns: Array<Column<MoveTask>> = [
    {
      key: "select",
      header: "",
      width: 32,
      cell: (t) => (
        <input
          type="checkbox"
          checked={checked.has(t.seq)}
          disabled={t.status === "yayınlandı"}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleTask(t.seq)}
          aria-label={`${t.label} görevini seç`}
        />
      ),
    },
    {
      key: "seq",
      header: "Sıra",
      align: "right",
      width: 52,
      cell: (t) => (
        <span className="mono">{String(t.seq).padStart(2, "0")}</span>
      ),
      sortValue: (t) => t.seq,
    },
    {
      key: "label",
      header: "Görev",
      cell: (t) => (
        <span>
          {t.label}
          {t.skuId ? (
            <span className="muted text-xs"> · {taskSkuName(t)}</span>
          ) : null}
        </span>
      ),
      sortValue: (t) => t.label,
    },
    {
      key: "source",
      header: "Kaynak",
      cell: (t) => <span className="mono">{t.sourceLocationId ?? "-"}</span>,
      sortValue: (t) => t.sourceLocationId ?? "",
    },
    {
      key: "target",
      header: "Hedef",
      cell: (t) => <span className="mono">{t.targetLocationId ?? "-"}</span>,
      sortValue: (t) => t.targetLocationId ?? "",
    },
    {
      key: "depends",
      header: "Önkoşul",
      cell: (t) =>
        t.dependsOn.length === 0 ? (
          <span className="subtle">-</span>
        ) : (
          <span className="mono">
            {t.dependsOn.map((d) => String(d).padStart(2, "0")).join(", ")}
          </span>
        ),
    },
    {
      key: "zone",
      header: "Zone",
      cell: (t) => t.zone,
      sortValue: (t) => t.zone,
      secondary: true,
    },
    {
      key: "load",
      header: "Yük",
      align: "right",
      cell: (t) => <span className="mono">{t.loadLabel}</span>,
    },
    {
      key: "status",
      header: "Durum",
      cell: (t) => <StatusTag status={t.status} />,
      sortValue: (t) => t.status,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Optimizasyon"
        title="Move Plan"
        description={`Plan ${plan.id} · ${plan.moveTaskCount} taşıma görevi · ${hours(
          plan.moveHours,
        )} tahmini yük`}
        secondaryActions={
          <Link className="btn" to="/optimization/slotting">
            Slotting Studio
          </Link>
        }
      />

      <div className="toolbar">
        <label className="field">
          <span className="field__label">Zone</span>
          <select
            className="select"
            value={zone}
            onChange={(e) => setZone(e.target.value as ZoneOption)}
          >
            <option value="all">Tüm zonlar</option>
            <option value="A">Zone A</option>
            <option value="B">Zone B</option>
            <option value="C">Zone C</option>
            <option value="D">Zone D</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Durum</span>
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusOption)}
          >
            <option value="all">Tümü</option>
            <option value="hazır">Hazır</option>
            <option value="bekliyor">Bekliyor</option>
            <option value="yayınlandı">Yayınlandı</option>
          </select>
        </label>
        <label className="checkbox-row" style={{ alignSelf: "flex-end" }}>
          <input
            type="checkbox"
            checked={zoneAllChecked}
            onChange={(e) => selectZoneA(e.target.checked)}
            aria-label="Zone A görevleri"
          />
          Zone A görevleri
        </label>
        <div className="toolbar__spacer" />
        <span className="text-xs muted" style={{ alignSelf: "flex-end" }}>
          {visible.length} görev gösteriliyor · {tasksWithStatus.length} toplam
        </span>
      </div>

      <div className="page__body--flush moveplan">
        <div className="moveplan__list">
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(t) => String(t.seq)}
            caption="Slot planından üretilen taşıma görevleri"
            selectedKey={selectedSeq === null ? null : String(selectedSeq)}
            onSelect={(t) => setSelectedSeq(t.seq)}
            emptyTitle="Bu filtrelerle görev bulunamadı."
            emptyHint="Zone veya durum filtresini temizleyin."
            emptyAction={
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setZone("all");
                  setStatusFilter("all");
                }}
              >
                Filtreleri temizle
              </button>
            }
          />
        </div>

        <aside className="rail" aria-label="Görev detayı">
          <section className="rail__section">
            <h2 className="rail__title">Kısmi onay</h2>
            {selection.length === 0 ? (
              <p className="text-sm muted" style={{ marginTop: 6 }}>
                Yayınlanacak görevleri seçin. Bağımlılık paketleri bölünemez;
                paketin tamamı seçilmelidir.
              </p>
            ) : (
              <>
                <dl className="deflist" style={{ marginTop: 8 }}>
                  <dt>Seçili görev</dt>
                  <dd>{selection.length}</dd>
                  <dt>Bağımlılık paketi</dt>
                  <dd>{selectionPackages.size}</dd>
                  <dt>Taşıma yükü</dt>
                  <dd>{hours(selectionHours)}</dd>
                  <dt>Tahmini net etki</dt>
                  <dd className="tone-positive">{pct(selectionBenefit)}</dd>
                </dl>

                {incompletePackages.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <Note tone="warning">
                      {incompletePackages
                        .map((p) => PACKAGE_LABELS[p] ?? p)
                        .join(", ")}{" "}
                      paketi eksik seçildi. Yayınlamadan önce paketin tamamını
                      seçin.
                    </Note>
                  </div>
                ) : null}
              </>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={
                  selection.length === 0 ||
                  incompletePackages.length > 0 ||
                  publishing
                }
                onClick={publish}
              >
                {publishing
                  ? "Yayınlanıyor…"
                  : `${selection.length} görevi WMS'e yayınla`}
              </button>
            </div>

            {publishedMessage ? (
              <div style={{ marginTop: 10 }} aria-live="polite">
                <Note tone="positive">
                  {publishedMessage}. Bu demo gerçek bir WMS'e yazmaz; görevler
                  yalnız arayüzde uygulandı olarak işaretlenir.
                </Note>
              </div>
            ) : null}
          </section>

          <section className="rail__section rail__section--grow">
            {selectedTask ? (
              <>
                <div className="row row--between">
                  <h2 className="rail__title">
                    Görev {String(selectedTask.seq).padStart(2, "0")}
                  </h2>
                  <StatusTag status={selectedTask.status} />
                </div>

                <div className="rail__sku">
                  <div className="rail__skuname">{selectedTask.label}</div>
                  <div className="text-xs muted">
                    {PACKAGE_LABELS[selectedTask.packageId] ??
                      selectedTask.packageId}{" "}
                    · Zone {selectedTask.zone}
                  </div>
                </div>

                <dl className="deflist" style={{ marginTop: 8 }}>
                  <dt>Kaynak</dt>
                  <dd className="mono">
                    {selectedTask.sourceLocationId ?? "-"}
                  </dd>
                  <dt>Hedef</dt>
                  <dd className="mono">
                    {selectedTask.targetLocationId ?? "-"}
                  </dd>
                  {selectedTask.skuId ? (
                    <>
                      <dt>SKU</dt>
                      <dd className="mono">{selectedTask.skuId}</dd>
                    </>
                  ) : null}
                  <dt>Yük</dt>
                  <dd className="mono">{selectedTask.loadLabel}</dd>
                  <dt>Tahmini süre</dt>
                  <dd className="mono">
                    {num(selectedTask.loadHours * 60, 0)} dk
                  </dd>
                  <dt>Beklenen fayda</dt>
                  <dd
                    className={
                      selectedTask.expectedBenefitPct < 0
                        ? "tone-positive"
                        : "muted"
                    }
                  >
                    {selectedTask.expectedBenefitPct === 0
                      ? "dolaylı"
                      : pct(selectedTask.expectedBenefitPct)}
                  </dd>
                </dl>

                <h3 className="section-label" style={{ marginTop: 14 }}>
                  Bağımlılıklar
                </h3>
                <DependencyChain
                  tasks={tasksWithStatus.filter(
                    (t) => t.packageId === selectedTask.packageId,
                  )}
                  activeSeq={selectedTask.seq}
                  onSelect={setSelectedSeq}
                />

                <h3 className="section-label" style={{ marginTop: 14 }}>
                  WMS yayın durumu
                </h3>
                <p className="text-sm muted" style={{ marginTop: 4 }}>
                  {selectedTask.status === "yayınlandı"
                    ? "Görev demo modunda yayınlandı. Gerçek entegrasyonda WMS task ID'si burada görünür."
                    : "Henüz yayınlanmadı. Yayın, plan sürümü ve kullanıcı ile birlikte audit kaydına yazılır."}
                </p>
              </>
            ) : (
              <div className="rail__empty">
                <h2 className="rail__title">Görev seçilmedi</h2>
                <p className="text-sm muted" style={{ marginTop: 6 }}>
                  Soldaki tablodan bir görev seçtiğinizde kaynak/hedef,
                  bağımlılıklar ve beklenen fayda burada görünür.
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Basit dikey step sequence — Sankey kullanılmaz (§9.4). */
function DependencyChain({
  tasks,
  activeSeq,
  onSelect,
}: {
  tasks: MoveTask[];
  activeSeq: number;
  onSelect: (seq: number) => void;
}) {
  const ordered = tasks.slice().sort((a, b) => a.seq - b.seq);
  return (
    <ol className="chain">
      {ordered.map((task, index) => (
        <li
          key={task.seq}
          className={`chain__item${task.seq === activeSeq ? " is-active" : ""}`}
        >
          {index > 0 ? (
            <span className="chain__connector" aria-hidden="true">
              <Icon name="arrowDown" size={14} />
            </span>
          ) : null}
          <button type="button" onClick={() => onSelect(task.seq)}>
            <span className="mono chain__seq">
              {String(task.seq).padStart(2, "0")}
            </span>
            <span className="chain__label">{task.label}</span>
            <span className="mono chain__loc">
              {task.targetLocationId ?? task.sourceLocationId ?? ""}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
