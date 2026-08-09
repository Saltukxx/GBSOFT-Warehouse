import { Suspense, lazy, useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BayVolume, Scene3DResponse, ZoneId } from "@gbsoft/domain";
import { PageHeader } from "../../components/ui/PageHeader";
import { Note, Panel, Segmented } from "../../components/ui/primitives";
import { WarehouseMap } from "../../components/warehouse-map/WarehouseMap";
import { buildLayers, type LayerId } from "../../components/warehouse-map/layers";
import type { CameraPreset, SectionCut } from "../../components/warehouse-3d/Scene3DView";
import {
  PLAN_ROLE_COLORS,
  PLAN_ROLE_LABELS,
  ZONE_COLORS,
  type ColorMode,
  type PlanRole,
} from "../../components/warehouse-3d/sceneColors";
import { detectWebgl } from "../../components/warehouse-3d/webgl";
import { useLayout, type LayoutState } from "../../data/useLayout";
import { fetchScene3D, DEMO_MODE } from "../../data/api";
import { useAsync } from "../../lib/useAsync";
import { useMoveReplay, useTourReplay } from "./useMoveReplay";
import { usePlanRoles } from "./usePlanRoles";
import "./twin3d.css";

/**
 * 3B dijital ikiz (Faz 6).
 *
 * Üç şey bu ekranın omurgasıdır:
 *
 *  1. **Sahne veriyi tekrar etmez.** Geometri `scene-3d` ucundan gelir,
 *     ısı skalası 2B haritayla aynı `buildLayers`'tan. Aynı göz iki ekranda
 *     farklı renkte görünemez.
 *  2. **3B bir yetenektir, zorunluluk değil.** WebGL yoksa ekran boş kalmaz;
 *     mevcut 2B harita aynı katmanlarla çizilir.
 *  3. **Türetilmiş kot gizlenmez.** Ölçülmüş raf yüksekliği olmayan tesiste
 *     sahne bunu üstte açıkça söyler.
 *
 * three.js ~600 kB'dir. Sayfa `lazy` yüklenir; 3B'ye girmeyen kullanıcı bu
 * yükü indirmez.
 */

const Scene3DView = lazy(() =>
  import("../../components/warehouse-3d/Scene3DView").then((module) => ({
    default: module.Scene3DView,
  })),
);

/** Katman listesi ısı katmanlarını ve kategorik katmanları birlikte taşır. */
type LayerChoice = LayerId | "zone" | "plan";

const LAYER_OPTIONS: Array<{ value: LayerChoice; label: string }> = [
  { value: "zone", label: "Zon" },
  { value: "pickTime", label: "Süre" },
  { value: "velocity", label: "Hız" },
  { value: "congestion", label: "Yoğunluk" },
  { value: "plan", label: "Plan" },
];

const PLAN_ROLE_ORDER: PlanRole[] = ["source", "target", "unchanged"];

const VIEW_OPTIONS: Array<{ value: CameraPreset; label: string }> = [
  { value: "iso", label: "İzometrik" },
  { value: "top", label: "Tepeden" },
  { value: "aisle", label: "Koridor" },
];

const CUT_OPTIONS: Array<{ value: "none" | "x" | "z"; label: string }> = [
  { value: "none", label: "Kesit yok" },
  { value: "x", label: "Koridor ekseni" },
  { value: "z", label: "Derinlik ekseni" },
];

export function Twin3DPage() {
  const webgl = useMemo(() => detectWebgl(), []);
  const twin = useLayout();
  const scene3d = useAsync<Scene3DResponse>(
    (signal) => fetchScene3D(signal),
    [],
  );

  const [layerId, setLayerId] = useState<LayerChoice>("zone");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [activeLevels, setActiveLevels] = useState<Set<number> | null>(null);
  const [activeZones, setActiveZones] = useState<Set<ZoneId> | null>(null);
  const [cutAxis, setCutAxis] = useState<"none" | "x" | "z">("none");
  const [cutRatio, setCutRatio] = useState(1);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("iso");
  const [showPaths, setShowPaths] = useState(true);
  // Reserve gözler varsayılan olarak kapalıdır. Üstten bakışta rafın en üst
  // hücresi görüş alanını kaplar ve pick yüzünün ısı rengini örter — asıl
  // veri taşıyan eleman pick yüzüdür, kapasite görünürlüğü isteğe bağlıdır.
  const [showReserve, setShowReserve] = useState(false);

  const scene = scene3d.data?.scene ?? null;

  const layers = useMemo(
    () => buildLayers(scene?.bays ?? []),
    [scene],
  );
  // Kategorik katmanlarda rampa kullanılmaz ama lejant için bir ısı katmanı
  // hazır tutulur; kullanıcı geri döndüğünde skala yeniden hesaplanmaz.
  const isCategorical = layerId === "zone" || layerId === "plan";
  const heatLayer = useMemo(
    () =>
      layers.find((layer) => layer.id === (isCategorical ? "pickTime" : layerId)) ??
      layers[0],
    [layers, layerId, isCategorical],
  );
  const colorMode: ColorMode =
    layerId === "zone" ? "zone" : layerId === "plan" ? "plan" : "layer";

  const planRoles = usePlanRoles(layerId === "plan");

  // `/twin/3d?tour=<id>&order=<code>` ile gelindiyse plan görevleri değil,
  // toplama turunun kendi güzergâhı oynatılır.
  const [searchParams] = useSearchParams();
  const tourId = searchParams.get("tour");
  const orderCode = searchParams.get("order");
  const moveReplay = useMoveReplay();
  const tourReplay = useTourReplay(orderCode, tourId);
  const replay = tourId && orderCode ? tourReplay : moveReplay;

  const levels = useMemo(
    () => [...new Set(scene?.bays.map((bay) => bay.level) ?? [])].sort((a, b) => a - b),
    [scene],
  );
  const zones = useMemo(
    () => (scene?.zones ?? []).map((zone) => zone.code),
    [scene],
  );

  const visibleBays = useMemo<BayVolume[]>(() => {
    if (!scene) return [];
    return scene.bays.filter(
      (bay) =>
        (activeLevels === null || activeLevels.has(bay.level)) &&
        (activeZones === null || activeZones.has(bay.zone)),
    );
  }, [scene, activeLevels, activeZones]);

  const sectionCut = useMemo<SectionCut>(() => {
    if (!scene || cutAxis === "none") return { axis: null, positionM: 0 };
    const span = cutAxis === "x" ? scene.bounds.widthM : scene.bounds.depthM;
    return { axis: cutAxis, positionM: span * cutRatio };
  }, [scene, cutAxis, cutRatio]);

  const focusBay = useMemo(
    () =>
      visibleBays.find((bay) => bay.locationCode === (hovered ?? selected)) ?? null,
    [visibleBays, hovered, selected],
  );

  // Aktif replay adımının poliçizgisi; sahne bunu çizer.
  const activeRoute = useMemo(() => {
    const step = replay.steps[replay.stepIndex];
    if (!step) return null;
    return { code: `${step.fromCode}->${step.toCode}`, points: step.points };
  }, [replay.steps, replay.stepIndex]);

  /* --- Klavye erişimi ------------------------------------------------ */
  // 3B sahne fare olmadan da gezilebilir olmalı: ok tuşları seçimi göz
  // listesinde ilerletir, Escape seçimi bırakır.
  const stageRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (visibleBays.length === 0) return;
      const step =
        event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? -1
            : 0;
      if (step === 0) {
        if (event.key === "Escape") setSelected(null);
        return;
      }
      event.preventDefault();
      const index = visibleBays.findIndex((bay) => bay.locationCode === selected);
      const next =
        index === -1
          ? 0
          : (index + step + visibleBays.length) % visibleBays.length;
      setSelected(visibleBays[next].locationCode);
    },
    [visibleBays, selected],
  );

  const toggle = <T,>(
    current: Set<T> | null,
    all: T[],
    value: T,
    apply: (next: Set<T> | null) => void,
  ) => {
    const base = current ?? new Set(all);
    const next = new Set(base);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // Hepsi seçiliyse filtre yok demektir; "hiçbiri" durumuna düşmeyi engelle.
    apply(next.size === 0 ? new Set(all) : next.size === all.length ? null : next);
  };

  /* --- Yükleme ve hata ----------------------------------------------- */
  if (scene3d.status === "error") {
    return (
      <div className="page">
        <PageHeader
          eyebrow="Dijital ikiz"
          title="3B depo"
          description="Aktif ikiz sürümünün üç boyutlu görünümü."
        />
        <Note tone="danger">
          3B sahne yüklenemedi. {scene3d.error.message}
        </Note>
        <button type="button" className="btn" onClick={scene3d.retry}>
          Tekrar dene
        </button>
      </div>
    );
  }

  return (
    <div className="page twin3d">
      <PageHeader
        eyebrow="Dijital ikiz"
        title="3B depo"
        description={
          scene
            ? `${scene.facilityName} · ikiz sürümü ${scene.layoutVersion} · ` +
              `${scene.bays.length} göz · ${scene.racks.length} raf yüzü`
            : "Aktif ikiz sürümü yükleniyor…"
        }
        context={
          <div className="twin3d__badges">
            <span className="tag">
              {DEMO_MODE ? "Demo verisi" : "Canlı ikiz"}
            </span>
            {scene ? (
              <span className="tag">
                {scene.bounds.widthM.toFixed(0)} × {scene.bounds.depthM.toFixed(0)} ×{" "}
                {scene.bounds.clearHeightM.toFixed(1)} m
              </span>
            ) : null}
          </div>
        }
      />

      {scene?.geometrySource === "derived" ? (
        <Note tone="warning">
          Raf kotları <strong>ölçülmemiş</strong>. Düşey eksen varsayılan raf
          profilinden türetildi; ayak izi ve mesafeler gerçek ikizden gelir.
          Ölçülmüş kot için layout şablonundaki <code>levelElevationM</code>,{" "}
          <code>levelClearHeightM</code> ve <code>depthM</code> kolonlarını
          doldurun.
        </Note>
      ) : null}

      {!webgl.supported ? (
        <Note tone="warning">
          Bu tarayıcıda 3B görünüm açılamadı ({webgl.reason}) — aynı katmanlarla
          2B harita gösteriliyor.
        </Note>
      ) : null}

      <div className="twin3d__body">
        <Panel
          title="Sahne"
          note={
            <span className="text-2xs muted">
              Sol tuş döndürür · tekerlek yakınlaştırır · sağ tuş kaydırır
            </span>
          }
        >
          <div
            ref={stageRef}
            className="twin3d__stage"
            tabIndex={0}
            role="application"
            aria-label="3B depo sahnesi. Ok tuşlarıyla göz seçin, Escape ile bırakın."
            onKeyDown={onKeyDown}
          >
            {!webgl.supported ? (
              <Fallback2D
                twin={twin}
                layerId={layerId}
                zoneFilter={
                  activeZones && activeZones.size === 1
                    ? [...activeZones][0]
                    : "all"
                }
                selected={selected}
                onSelect={setSelected}
              />
            ) : !scene ? (
              <div className="twin3d__loading" aria-busy="true">
                3B sahne yükleniyor…
              </div>
            ) : (
              <Suspense
                fallback={<div className="twin3d__loading">Sahne motoru yükleniyor…</div>}
              >
                <Scene3DView
                  scene={scene}
                  bays={visibleBays}
                  layer={heatLayer}
                  colorMode={colorMode}
                  planRoles={planRoles.roles}
                  selectedCode={selected}
                  hoveredCode={hovered}
                  onSelect={setSelected}
                  onHover={setHovered}
                  sectionCut={sectionCut}
                  showPaths={showPaths}
                  showReserve={showReserve}
                  cameraPreset={cameraPreset}
                  route={activeRoute}
                  routeProgress={replay.progress}
                />
              </Suspense>
            )}
          </div>
        </Panel>

        <aside className="twin3d__side">
          <Panel title="Katman">
            <Segmented
              label="Renk katmanı"
              value={layerId}
              options={LAYER_OPTIONS}
              onChange={setLayerId}
            />
            {layerId === "zone" ? (
              <ul className="twin3d__legend">
                {zones.map((code) => (
                  <li key={code}>
                    <span
                      className="twin3d__swatch"
                      style={{ background: ZONE_COLORS[code] }}
                      aria-hidden="true"
                    />
                    Zone {code}
                  </li>
                ))}
              </ul>
            ) : layerId === "plan" ? (
              <PlanLegend planRoles={planRoles} />
            ) : (
              <div className="twin3d__ramp">
                <span className="text-2xs muted">{heatLayer?.legendLow}</span>
                <span
                  className="twin3d__rampbar"
                  style={{
                    background: `linear-gradient(90deg, ${heatLayer?.ramp[0]}, ${heatLayer?.ramp[1]})`,
                  }}
                  aria-hidden="true"
                />
                <span className="text-2xs muted">{heatLayer?.legendHigh}</span>
              </div>
            )}
            <p className="text-2xs muted twin3d__hint">
              Bloklu göz her katmanda kırmızıdır; kapalı bir gözü ısı değerine
              göre boyamak yanıltıcı olurdu.
            </p>
          </Panel>

          <Panel title="Filtre">
            <div className="twin3d__filter">
              <span className="text-2xs muted">Kademe</span>
              <div className="twin3d__chips">
                {levels.map((level) => {
                  const on = activeLevels === null || activeLevels.has(level);
                  const profile = scene?.levelProfile.find((p) => p.level === level);
                  const detail = profile
                    ? `kot ${profile.elevationM.toFixed(2)} m, açıklık ${profile.clearHeightM.toFixed(2)} m`
                    : null;
                  return (
                    <button
                      key={level}
                      type="button"
                      className="twin3d__chip"
                      aria-pressed={on}
                      onClick={() => toggle(activeLevels, levels, level, setActiveLevels)}
                      // `title` erişilebilir adı ezer; kademe numarası
                      // ekran okuyucuda kaybolmasın diye ad açıkça verilir.
                      aria-label={detail ? `Kademe ${level} — ${detail}` : `Kademe ${level}`}
                      title={detail ?? undefined}
                    >
                      Kademe {level}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="twin3d__filter">
              <span className="text-2xs muted">Zon</span>
              <div className="twin3d__chips">
                {zones.map((code) => {
                  const on = activeZones === null || activeZones.has(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      className="twin3d__chip"
                      aria-pressed={on}
                      onClick={() => toggle(activeZones, zones, code, setActiveZones)}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="twin3d__filter">
              <span className="text-2xs muted">Görünüm</span>
              <Segmented
                label="Kamera açısı"
                value={cameraPreset}
                options={VIEW_OPTIONS}
                onChange={setCameraPreset}
              />
            </div>

            <div className="twin3d__filter">
              <span className="text-2xs muted">Kesit</span>
              <Segmented
                label="Kesit ekseni"
                value={cutAxis}
                options={CUT_OPTIONS}
                onChange={setCutAxis}
              />
              {cutAxis !== "none" ? (
                <label className="twin3d__slider">
                  <span className="text-2xs muted">
                    {(
                      (cutAxis === "x"
                        ? (scene?.bounds.widthM ?? 0)
                        : (scene?.bounds.depthM ?? 0)) * cutRatio
                    ).toFixed(1)}{" "}
                    m
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={cutRatio}
                    onChange={(event) => setCutRatio(Number(event.target.value))}
                    aria-label="Kesit konumu"
                  />
                </label>
              ) : null}
            </div>

            <label className="twin3d__toggle">
              <input
                type="checkbox"
                checked={showPaths}
                onChange={(event) => setShowPaths(event.target.checked)}
              />
              Ekipman yollarını göster
            </label>

            <label className="twin3d__toggle">
              <input
                type="checkbox"
                checked={showReserve}
                onChange={(event) => setShowReserve(event.target.checked)}
              />
              Reserve gözleri göster
            </label>

            <p className="text-2xs muted twin3d__hint">
              {visibleBays.length} / {scene?.bays.length ?? 0} göz görünür.
            </p>
          </Panel>

          <Panel title="Rota replay">
            <ReplayPanel replay={replay} />
          </Panel>

          <Panel title="Seçim">
            {focusBay ? (
              <BayDetail bay={focusBay} />
            ) : (
              <p className="text-xs muted">
                Bir göz seçin — ya da sahneye odaklanıp ok tuşlarını kullanın.
              </p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** Plan senaryosu lejantı: hangi göz boşalıyor, hangisi doluyor. */
function PlanLegend({ planRoles }: { planRoles: ReturnType<typeof usePlanRoles> }) {
  if (planRoles.status === "loading") {
    return <p className="text-xs muted">Aktif plan yükleniyor…</p>;
  }
  if (planRoles.status === "error") {
    return <Note tone="danger">Plan okunamadı. {planRoles.error?.message}</Note>;
  }
  if (planRoles.status === "empty") {
    return (
      <Note tone="neutral">
        Aktif planda taşınan göz yok; sahnede her şey «değişmiyor» rengindedir.
      </Note>
    );
  }

  return (
    <>
      <ul className="twin3d__legend">
        {PLAN_ROLE_ORDER.map((role) => (
          <li key={role}>
            <span
              className="twin3d__swatch"
              style={{ background: PLAN_ROLE_COLORS[role] }}
              aria-hidden="true"
            />
            {PLAN_ROLE_LABELS[role]}
            {role !== "unchanged" ? (
              <span className="twin3d__count">{planRoles.counts[role]}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {planRoles.planLabel ? (
        <p className="text-2xs muted twin3d__hint">Plan: {planRoles.planLabel}</p>
      ) : null}
    </>
  );
}

/** Move-task rotalarının oynatma kontrolü. */
function ReplayPanel({ replay }: { replay: ReturnType<typeof useMoveReplay> }) {
  if (replay.status === "idle") {
    return (
      <>
        <p className="text-xs muted">
          Aktif planın taşıma görevleri yürüyüş grafı üzerinde oynatılır.
        </p>
        <button
          type="button"
          className="btn"
          onClick={replay.load}
          style={{ marginTop: "var(--space-3)" }}
        >
          Rotayı yükle
        </button>
      </>
    );
  }

  if (replay.status === "loading") {
    return <p className="text-xs muted">Rota grafta hesaplanıyor…</p>;
  }

  if (replay.status === "error") {
    return (
      <>
        <Note tone="danger">Rota alınamadı. {replay.error?.message}</Note>
        <button type="button" className="btn" onClick={replay.load}>
          Tekrar dene
        </button>
      </>
    );
  }

  if (replay.status === "empty") {
    return (
      <Note tone="neutral">
        Aktif planda taşınacak görev yok. Önce Slotting Studio'da yeniden
        optimize edin.
      </Note>
    );
  }

  const current = replay.steps[replay.stepIndex];

  return (
    <div className="twin3d__replay">
      <div className="twin3d__transport">
        <button
          type="button"
          className="btn"
          onClick={replay.playing ? replay.pause : replay.play}
        >
          {replay.playing ? "Duraklat" : "Oynat"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={replay.reset}>
          Başa sar
        </button>
      </div>

      <p className="text-2xs muted">
        {replay.steps.length} bacak · toplam {replay.totalDistanceM} m
        {replay.planLabel ? ` · ${replay.planLabel}` : ""}
      </p>

      {replay.unreachable.length > 0 ? (
        <Note tone="warning">
          {replay.unreachable.length} bacak grafta çözülemedi:{" "}
          {replay.unreachable[0].reason}
        </Note>
      ) : null}

      <ol className="twin3d__steps">
        {replay.steps.map((step, index) => (
          <li key={`${step.fromCode}-${step.toCode}-${index}`}>
            <button
              type="button"
              className="twin3d__step"
              aria-current={index === replay.stepIndex}
              onClick={() => replay.setStepIndex(index)}
            >
              <span className="twin3d__steplabel">{step.label}</span>
              <span className="twin3d__stepdist">{step.distanceM.toFixed(1)} m</span>
            </button>
          </li>
        ))}
      </ol>

      {current ? (
        <label className="twin3d__slider">
          <span className="text-2xs muted">
            {(current.distanceM * replay.progress).toFixed(1)} /{" "}
            {current.distanceM.toFixed(1)} m
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={replay.progress}
            onChange={(event) => {
              replay.pause();
              replay.setProgress(Number(event.target.value));
            }}
            aria-label="Bacak üzerindeki konum"
          />
        </label>
      ) : null}
    </div>
  );
}

function BayDetail({ bay }: { bay: BayVolume }) {
  const rows: Array<[string, string]> = [
    ["Zon / koridor", `${bay.zone} · koridor ${bay.aisle} · ${bay.side === "left" ? "sol" : "sağ"} yüz`],
    ["Göz / kademe", `${bay.bay}. göz · kademe ${bay.level}`],
    ["Kot", `${bay.box.center.y.toFixed(2)} m · açıklık ${bay.box.size.y.toFixed(2)} m`],
    ["Ayak izi", `${bay.box.size.x.toFixed(2)} × ${bay.box.size.z.toFixed(2)} m`],
    ["Dock mesafesi", `${bay.distanceToDockM.toFixed(1)} m`],
    ["Picking süresi", `${bay.pickTimeSec.toFixed(0)} sn`],
    ["Hız", `${bay.picksPerDay} pick/gün`],
    ["Ekipman", bay.equipment],
  ];

  return (
    <div className="twin3d__detail">
      <div className="twin3d__code">{bay.locationCode}</div>
      {bay.blocked ? (
        <Note tone="danger">Bloklu: {bay.blockedReason ?? "neden kayıtlı değil"}</Note>
      ) : null}
      {bay.goldenZone ? <span className="tag">Altın bölge</span> : null}
      <dl className="twin3d__dl">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const NO_IDS: Set<string> = new Set();

/**
 * WebGL yoksa aynı katmanlarla 2B harita.
 *
 * Ayrı bir "basit görünüm" yazmıyoruz: kullanıcı düşük donanımda da ürünün
 * gerçek haritasını görür, yalnız düşey eksen ve kesit yeteneği eksilir.
 */
function Fallback2D({
  twin,
  layerId,
  zoneFilter,
  selected,
  onSelect,
}: {
  twin: LayoutState;
  layerId: LayerChoice;
  zoneFilter: ZoneId | "all";
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (!twin.layout) {
    return <div className="twin3d__loading">Depo yerleşimi yükleniyor…</div>;
  }
  // 2B haritada zon kategorik bir katman değil; plan senaryosunun karşılığı
  // ise `planChange`. Kategorik seçimler oraya eşlenir.
  const mapLayer: LayerId =
    layerId === "zone" ? "pickTime" : layerId === "plan" ? "planChange" : layerId;
  return (
    <WarehouseMap
      layout={twin.layout}
      layers={twin.layers}
      locations={twin.locations}
      layer={mapLayer}
      viewMode="current"
      zoneFilter={zoneFilter}
      selectedId={selected}
      onSelect={onSelect}
      arrows={[]}
      sourceIds={NO_IDS}
      targetIds={NO_IDS}
      lockedIds={NO_IDS}
      excludedIds={NO_IDS}
    />
  );
}
