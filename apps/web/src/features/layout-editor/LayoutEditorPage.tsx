import { useMemo, useState } from "react";
import type {
  AisleZoning,
  BayProfile,
  Equipment,
  ImportReport,
  LayoutBlueprint,
  ZoneId,
} from "@gbsoft/domain";
import {
  DEFAULT_BLUEPRINT,
  ZONE_IDS,
  blueprintToFloorAreaCsvRows,
  blueprintToLayoutCsvRows,
  buildLayoutDraft,
  toCsv,
} from "@gbsoft/domain";
import { PageHeader } from "../../components/ui/PageHeader";
import { MetricStrip, Note, Panel } from "../../components/ui/primitives";
import { WarehouseMap } from "../../components/warehouse-map/WarehouseMap";
import { buildLayers } from "../../components/warehouse-map/layers";
import { Icon } from "../../components/ui/Icon";
import { ImportReportPanel } from "../imports/ImportReportPanel";
import { DEMO_MODE, uploadImport } from "../../data/api";
import { num } from "../../lib/format";
import "./layout-editor.css";

/**
 * 2B layout editörü — basit sürüm.
 *
 * Yeni bir tesisin geometrisi burada parametrik olarak tanımlanır: koridor
 * sayısı, göz sırası, zon ataması, raf profili, cross-aisle ve dock konumu.
 * Harita önizlemesi mevcut `WarehouseMap` bileşenidir; editör kendi çizim
 * katmanını kurmaz.
 *
 * Kaydetme kendi yazma yolunu açmaz: taslak, elle doldurulmuş bir dosyayla
 * birebir aynı CSV satırlarına çevrilir ve aynı içe aktarma hattından geçer.
 * Doğrulama, sürümleme ve denetim izi bu sayede tek yerde kalır.
 */

const EQUIPMENT_LABEL: Record<Equipment, string> = {
  manual: "Manuel",
  cart: "Araba",
  forklift: "Forklift",
};

type NumericField = {
  key: keyof LayoutBlueprint;
  label: string;
  hint: string;
  min: number;
  max: number;
  integer?: boolean;
};

const GRID_FIELDS: NumericField[] = [
  { key: "aisleCount", label: "Koridor sayısı", hint: "adet", min: 1, max: 40, integer: true },
  { key: "baysPerFace", label: "Yüz başına göz", hint: "adet", min: 1, max: 12, integer: true },
  { key: "crossAisleAfterBay", label: "Cross-aisle", hint: "kaçıncı gözden sonra · 0 = yok", min: 0, max: 11, integer: true },
  { key: "unitsPerMeter", label: "Birim / metre", hint: "ölçek", min: 0.1, max: 100 },
];

const GEOMETRY_FIELDS: NumericField[] = [
  { key: "aislePitch", label: "Koridor aralığı", hint: "birim", min: 1, max: 400 },
  { key: "rackWidth", label: "Raf derinliği", hint: "birim", min: 1, max: 200 },
  { key: "walkwayWidth", label: "Yürüme koridoru", hint: "birim", min: 0, max: 200 },
  { key: "bayHeight", label: "Göz yüksekliği", hint: "birim", min: 1, max: 300 },
  { key: "bayGap", label: "Göz arası boşluk", hint: "birim", min: 0, max: 60 },
  { key: "crossAisleGap", label: "Cross-aisle genişliği", hint: "birim", min: 0, max: 120 },
];

export function LayoutEditorPage() {
  const [bp, setBp] = useState<LayoutBlueprint>(DEFAULT_BLUEPRINT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<"idle" | "validating" | "saving">("idle");
  const [failure, setFailure] = useState<Error | null>(null);

  const draft = useMemo(() => buildLayoutDraft(bp), [bp]);
  const layers = useMemo(() => buildLayers(draft.locations), [draft.locations]);
  const selected = draft.locations.find((l) => l.id === selectedId) ?? null;

  const empty = useMemo(
    () => ({
      arrows: [],
      sourceIds: new Set<string>(),
      targetIds: new Set<string>(),
      lockedIds: new Set<string>(),
      excludedIds: new Set<string>(),
    }),
    [],
  );

  function patch(next: Partial<LayoutBlueprint>) {
    setBp((current) => ({ ...current, ...next }));
    setReport(null);
  }

  function setNumeric(field: NumericField, raw: string) {
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(field.max, Math.max(field.min, value));
    patch({ [field.key]: field.integer ? Math.round(clamped) : clamped } as Partial<LayoutBlueprint>);
  }

  function setZoning(aisle: number, side: "left" | "right", zone: ZoneId) {
    patch({
      zoning: zoningFor(bp).map((z) =>
        z.aisle === aisle ? { ...z, [side]: zone } : z,
      ),
    });
  }

  function setProfile(bay: number, next: Partial<BayProfile>) {
    patch({
      bayProfiles: profilesFor(bp).map((p) =>
        p.bay === bay ? { ...p, ...next } : p,
      ),
    });
  }

  function toggleBlocked(code: string, reason: string) {
    const blocked = { ...bp.blocked };
    if (reason === "") delete blocked[code];
    else blocked[code] = reason;
    patch({ blocked });
  }

  /**
   * Doğrulama ve kaydetme aynı hattan geçer; kaydetme yalnız `dryRun`
   * bayrağını kapatır ve ardından raf dışı alanları yazar.
   */
  async function run(dryRun: boolean) {
    setBusy(dryRun ? "validating" : "saving");
    setFailure(null);
    try {
      const layoutCsv = toCsv(blueprintToLayoutCsvRows(bp), ";");
      const result = await uploadImport(
        "layout",
        "layout-editoru.csv",
        layoutCsv,
        {
          unitsPerMeter: String(bp.unitsPerMeter),
          dockAnchorX: String(draft.layout.dockAnchor.x),
          dockAnchorY: String(draft.layout.dockAnchor.y),
          viewBoxWidth: String(draft.layout.viewBox.width),
          viewBoxHeight: String(draft.layout.viewBox.height),
          note: "Layout editörü",
          ...(dryRun ? {} : { activate: "1" }),
        },
        dryRun,
      );
      setReport(result);

      // Geometri yazıldıysa raf dışı alanlar aktif sürüme eklenir.
      if (!dryRun && result.status === "APPLIED") {
        await uploadImport(
          "floor-area",
          "layout-editoru-alanlar.csv",
          toCsv(blueprintToFloorAreaCsvRows(bp), ";"),
          {},
          false,
        );
      }
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setBusy("idle");
    }
  }

  const locationCount = draft.locations.length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Sistem"
        title="Layout editörü"
        description="Tesis geometrisini parametrik olarak tanımlayın. Kaydetme yeni bir dijital ikiz sürümü açar; mevcut sürüm değişmez."
        secondaryActions={
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              setBp(DEFAULT_BLUEPRINT);
              setSelectedId(null);
              setReport(null);
            }}
          >
            Varsayılana dön
          </button>
        }
        primaryAction={
          <>
            <button
              type="button"
              className="btn"
              disabled={busy !== "idle"}
              onClick={() => void run(true)}
            >
              {busy === "validating" ? "Doğrulanıyor…" : "Doğrula"}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy !== "idle" || DEMO_MODE}
              title={
                DEMO_MODE
                  ? "Demo modunda veritabanı yok; kaydetme yapılamaz."
                  : undefined
              }
              onClick={() => void run(false)}
            >
              <Icon name="upload" size={14} />
              {busy === "saving" ? "Kaydediliyor…" : "Kaydet ve aktifleştir"}
            </button>
          </>
        }
      />

      {DEMO_MODE ? (
        <Note tone="warning">
          Demo modundasınız. Geometriyi tasarlayıp doğrulayabilirsiniz, ama
          veritabanı olmadığı için kaydetme yapılmaz.
        </Note>
      ) : null}

      <MetricStrip
        metrics={[
          {
            label: "Göz sayısı",
            value: num(locationCount),
            context: `${bp.aisleCount} koridor × 2 yüz × ${bp.baysPerFace} göz`,
          },
          {
            label: "Kullanılan zon",
            value: num(draft.layout.zones.length),
            context: draft.layout.zones.map((z) => z.code).join(" · ") || "—",
          },
          {
            label: "Çizim alanı",
            value: `${Math.round(draft.layout.viewBox.width)}×${Math.round(draft.layout.viewBox.height)}`,
            context: `${num(bp.unitsPerMeter, 1)} birim = 1 m`,
          },
          {
            label: "Bloklu göz",
            value: num(Object.keys(bp.blocked).length),
            context: "haritada tıklayarak işaretlenir",
          },
        ]}
      />

      {draft.warnings.map((warning) => (
        <Note key={warning} tone="warning">
          {warning}
        </Note>
      ))}

      <div className="editor">
        {/* --- Izgara --------------------------------------------------- */}
        <Panel title="Izgara" className="editor__grid">
          <div className="editor__fields">
            {GRID_FIELDS.map((field) => (
              <NumberField
                key={String(field.key)}
                field={field}
                value={bp[field.key] as number}
                onChange={(raw) => setNumeric(field, raw)}
              />
            ))}
          </div>
          <details className="editor__details">
            <summary>Çizim ölçüleri</summary>
            <div className="editor__fields">
              {GEOMETRY_FIELDS.map((field) => (
                <NumberField
                  key={String(field.key)}
                  field={field}
                  value={bp[field.key] as number}
                  onChange={(raw) => setNumeric(field, raw)}
                />
              ))}
            </div>
          </details>
          <details className="editor__details">
            <summary>Dock alanı</summary>
            <div className="editor__fields">
              {(["x", "y", "width", "height"] as const).map((key) => (
                <label key={key} className="editor__field">
                  <span>Dock {key}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={String(bp.dock[key])}
                    onChange={(e) => {
                      const value = Number(e.target.value.replace(",", "."));
                      if (Number.isFinite(value)) {
                        patch({ dock: { ...bp.dock, [key]: value } });
                      }
                    }}
                  />
                </label>
              ))}
            </div>
          </details>
        </Panel>

        {/* --- Harita önizlemesi ---------------------------------------- */}
        <Panel
          title="Önizleme"
          className="editor__map"
          note="Yeni tesiste ölçülmüş etkinlik yoktur; ısı katmanları düzdür."
          flush
        >
          <WarehouseMap
            layout={draft.layout}
            layers={layers}
            locations={draft.locations}
            layer="pickTime"
            viewMode="current"
            zoneFilter="all"
            selectedId={selectedId}
            onSelect={setSelectedId}
            height={420}
            {...empty}
          />
        </Panel>

        {/* --- Seçili göz ----------------------------------------------- */}
        <Panel title={selected ? `Göz ${selected.id}` : "Göz"} className="editor__inspector">
          {selected ? (
            <div className="editor__inspector-body">
              <dl className="editor__facts">
                <div>
                  <dt>Zon / koridor</dt>
                  <dd className="mono">
                    {selected.zone} · {String(selected.aisle).padStart(2, "0")}
                  </dd>
                </div>
                <div>
                  <dt>Göz / seviye</dt>
                  <dd className="mono">
                    {selected.bay} · {selected.level}
                  </dd>
                </div>
                <div>
                  <dt>Kapasite</dt>
                  <dd className="mono">
                    {num(selected.maxWeightKg)} kg · {num(selected.maxVolumeM3, 1)} m³
                  </dd>
                </div>
                <div>
                  <dt>Dock mesafesi</dt>
                  <dd className="mono">{num(selected.distanceToDockM, 1)} m</dd>
                </div>
              </dl>

              <label className="editor__field">
                <span>Engel nedeni</span>
                <input
                  type="text"
                  placeholder="boş bırakılırsa göz açık"
                  value={bp.blocked[selected.id] ?? ""}
                  onChange={(e) => toggleBlocked(selected.id, e.target.value)}
                />
              </label>
              <p className="text-xs subtle">
                Kapasite ve ekipman göz sırasının raf profilinden gelir;
                aşağıdaki tablodan değiştirin.
              </p>
            </div>
          ) : (
            <p className="text-sm subtle">
              Haritadan bir göz seçin. Bloklu göz işaretlemek ve ayrıntıları
              görmek için kullanılır.
            </p>
          )}
        </Panel>

        {/* --- Zon ataması ---------------------------------------------- */}
        <Panel
          title="Zon ataması"
          className="editor__zoning"
          note="Bir koridorun iki yüzü farklı zonlara ait olabilir."
        >
          <div className="zoning">
            <div className="zoning__head">
              <span>Koridor</span>
              <span>Sol yüz</span>
              <span>Sağ yüz</span>
            </div>
            {zoningFor(bp).map((row) => (
              <div className="zoning__row" key={row.aisle}>
                <span className="mono">{String(row.aisle).padStart(2, "0")}</span>
                {(["left", "right"] as const).map((side) => (
                  <select
                    key={side}
                    value={row[side]}
                    aria-label={`Koridor ${row.aisle} ${side === "left" ? "sol" : "sağ"} yüz zonu`}
                    onChange={(e) => setZoning(row.aisle, side, e.target.value as ZoneId)}
                  >
                    {ZONE_IDS.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            ))}
          </div>
        </Panel>

        {/* --- Raf profili ---------------------------------------------- */}
        <Panel
          title="Raf profili"
          className="editor__profiles"
          note="Kapasite ve ekipman göz sırasına göre değişir."
        >
          <div className="profiles">
            <div className="profiles__head">
              <span>Göz</span>
              <span>Seviye</span>
              <span>Kapasite (kg)</span>
              <span>Hacim (m³)</span>
              <span>Ekipman</span>
              <span>Altın bölge</span>
            </div>
            {profilesFor(bp).map((profile) => (
              <div className="profiles__row" key={profile.bay}>
                <span className="mono">{profile.bay}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`Göz ${profile.bay} seviyesi`}
                  value={String(profile.level)}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isInteger(value) && value >= 1) {
                      setProfile(profile.bay, { level: value });
                    }
                  }}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Göz ${profile.bay} taşıma kapasitesi`}
                  value={String(profile.maxWeightKg)}
                  onChange={(e) => {
                    const value = Number(e.target.value.replace(",", "."));
                    if (Number.isFinite(value) && value >= 0) {
                      setProfile(profile.bay, { maxWeightKg: value });
                    }
                  }}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Göz ${profile.bay} hacim kapasitesi`}
                  value={String(profile.maxVolumeM3)}
                  onChange={(e) => {
                    const value = Number(e.target.value.replace(",", "."));
                    if (Number.isFinite(value) && value >= 0) {
                      setProfile(profile.bay, { maxVolumeM3: value });
                    }
                  }}
                />
                <select
                  value={profile.equipment}
                  aria-label={`Göz ${profile.bay} ekipman sınıfı`}
                  onChange={(e) =>
                    setProfile(profile.bay, { equipment: e.target.value as Equipment })
                  }
                >
                  {(Object.keys(EQUIPMENT_LABEL) as Equipment[]).map((eq) => (
                    <option key={eq} value={eq}>
                      {EQUIPMENT_LABEL[eq]}
                    </option>
                  ))}
                </select>
                <input
                  type="checkbox"
                  aria-label={`Göz ${profile.bay} altın bölge`}
                  checked={profile.goldenZone}
                  onChange={(e) =>
                    setProfile(profile.bay, { goldenZone: e.target.checked })
                  }
                />
              </div>
            ))}
          </div>
        </Panel>

        {failure ? (
          <div className="editor__report">
            <Note tone="danger">{failure.message}</Note>
          </div>
        ) : null}

        {report ? (
          <ImportReportPanel
            report={report}
            title={`İçe aktarma raporu · ${report.status === "APPLIED" ? "Kaydedildi" : report.status === "REJECTED" ? "Reddedildi" : "Doğrulandı"}`}
            className="editor__report"
          />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NumberField({
  field,
  value,
  onChange,
}: {
  field: NumericField;
  value: number;
  onChange: (raw: string) => void;
}) {
  return (
    <label className="editor__field">
      <span>{field.label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
      <small>{field.hint}</small>
    </label>
  );
}

/** Koridor sayısı değiştiğinde zon listesi otomatik genişler ve daralır. */
function zoningFor(bp: LayoutBlueprint): AisleZoning[] {
  return Array.from({ length: bp.aisleCount }, (_, i) => {
    const aisle = i + 1;
    return (
      bp.zoning.find((z) => z.aisle === aisle) ?? {
        aisle,
        left: "A" as ZoneId,
        right: "B" as ZoneId,
      }
    );
  });
}

/** Göz sayısı değiştiğinde raf profili listesi de takip eder. */
function profilesFor(bp: LayoutBlueprint): BayProfile[] {
  return Array.from({ length: bp.baysPerFace }, (_, i) => {
    const bay = i + 1;
    return (
      bp.bayProfiles.find((p) => p.bay === bay) ?? {
        bay,
        level: 1,
        maxWeightKg: 500,
        maxVolumeM3: 1.2,
        equipment: "manual" as Equipment,
        goldenZone: false,
      }
    );
  });
}
