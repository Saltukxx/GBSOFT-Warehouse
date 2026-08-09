import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  Equipment,
  PickOrderDetail,
  PickOrderSummary,
  PickTourPlan,
  PickTourView,
} from "@gbsoft/domain";
import { PageHeader } from "../../components/ui/PageHeader";
import { MetricStrip, Note, Panel, Segmented } from "../../components/ui/primitives";
import {
  awaitOptimizationRun,
  fetchPickOrder,
  fetchPickOrders,
  fetchPickTours,
  optimizePickOrder,
} from "../../data/api";
import { useAsync } from "../../lib/useAsync";
import "./pickorders.css";

/**
 * Yükleme siparişleri ve toplama turları (Faz 6.5).
 *
 * Ekranın cevapladığı soru: **bu siparişi en hızlı nasıl toplarız?**
 *
 * Üç şey burada bilinçlidir:
 *
 *  1. **Makespan asıl ölçüdür.** Toplayıcılar paralel çalışır; sipariş en geç
 *     biten tur bitince hazırdır. Toplam süre iş gücü maliyetidir, teslim
 *     süresi değil. İkisi ayrı gösterilir.
 *  2. **Optimum iddia edilmez.** Routing kanıtlanmış optimum vermez; sonuç
 *     alt sınırla birlikte gösterilir ki kullanıcı ne kadar yaklaşıldığını
 *     görsün.
 *  3. **Süreler kalibre değilse tahmindir** ve ekran bunu söyler.
 */

const EQUIPMENT_OPTIONS: Array<{ value: Equipment; label: string }> = [
  { value: "manual", label: "Yaya" },
  { value: "cart", label: "Araba" },
  { value: "forklift", label: "Forklift" },
];

const OBJECTIVE_OPTIONS: Array<{ value: "makespan" | "total"; label: string }> = [
  { value: "makespan", label: "En hızlı teslim" },
  { value: "total", label: "En az iş gücü" },
];

function minutes(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PickOrdersPage() {
  const orders = useAsync<PickOrderSummary[]>((signal) => fetchPickOrders(signal), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<Equipment>("cart");
  const [objective, setObjective] = useState<"makespan" | "total">("makespan");
  const [vehicleCount, setVehicleCount] = useState(3);

  const [detail, setDetail] = useState<PickOrderDetail | null>(null);
  const [plan, setPlan] = useState<PickTourPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<PickTourPlan["skippedLines"]>([]);

  const list = orders.data ?? [];
  const active = selectedId ?? list[0]?.id ?? null;

  /* Seçilen siparişin satırları ve varsa mevcut tur planı. */
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let alive = true;

    (async () => {
      setError(null);
      try {
        const loaded = await fetchPickOrder(active, controller.signal);
        if (!alive) return;
        setDetail(loaded);
        setSkipped([]);
        try {
          const tours = await fetchPickTours(active, controller.signal);
          if (alive) setPlan(tours);
        } catch {
          // Henüz optimize edilmemiş sipariş — hata değil, boş durum.
          if (alive) setPlan(null);
        }
      } catch (cause) {
        if (!alive) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [active]);

  const optimize = useCallback(async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const started = await optimizePickOrder(active, {
        equipment,
        vehicleCount,
        objective,
      });
      setSkipped(started.skippedLines);
      const run = await awaitOptimizationRun(started.runId);
      if (run.status !== "feasible") {
        setError(
          run.infeasibilityReasons?.join(" ") ??
            `Optimizasyon ${run.status} durumunda bitti.`,
        );
        setPlan(null);
        return;
      }
      setPlan(await fetchPickTours(active));
      orders.retry();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [active, equipment, vehicleCount, objective, orders]);

  const metrics = useMemo(() => {
    if (!plan) return [];
    return [
      {
        label: "Teslim süresi (makespan)",
        value: minutes(plan.makespanSec),
        context: "En geç biten tur — sipariş bu sürede hazır.",
      },
      {
        label: "Toplam iş gücü",
        value: minutes(plan.totalSec),
        context: `${plan.tours.length} turun toplamı; teslim süresi değil.`,
      },
      {
        label: "Alt sınır",
        value: minutes(plan.lowerBoundSec),
        context: "Makespan bunun altına inemez. Optimum iddiası değildir.",
      },
      {
        label: "Toplam mesafe",
        value: `${Math.round(
          plan.tours.reduce((sum, tour) => sum + tour.totalDistanceM, 0),
        )} m`,
        context: "Yürüyüş grafından ölçülen toplam yol.",
      },
    ];
  }, [plan]);

  return (
    <div className="page pickorders">
      <PageHeader
        eyebrow="Operasyon"
        title="Yükleme siparişleri"
        description="Siparişi en hızlı toplayacak tur sırasını üretir ve rotayı gösterir."
      />

      {orders.status === "error" ? (
        <Note tone="danger">Siparişler yüklenemedi. {orders.error.message}</Note>
      ) : null}

      {orders.status === "ready" && list.length === 0 ? (
        <Note tone="neutral">
          Bu tesiste yükleme siparişi yok. <code>POST /api/pick-orders</code> ile
          oluşturabilir veya <code>pick-order</code> şablonuyla içe aktarabilirsiniz.
        </Note>
      ) : null}

      <div className="pickorders__body">
        <aside className="pickorders__list">
          <Panel title="Siparişler">
            <ul className="pickorders__orders">
              {list.map((order) => (
                <li key={order.id}>
                  <button
                    type="button"
                    className="pickorders__order"
                    aria-current={order.id === active}
                    onClick={() => setSelectedId(order.id)}
                  >
                    <span className="pickorders__code">{order.code}</span>
                    <span className="text-2xs muted">
                      {order.lineCount} satır · {order.unitCount} birim
                      {order.hasTours ? " · planlandı" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>

        <div className="pickorders__main">
          <Panel
            title={detail ? `${detail.code} · toplama planı` : "Toplama planı"}
            note={
              detail?.dockCode ? (
                <span className="text-2xs muted">Dock: {detail.dockCode}</span>
              ) : null
            }
          >
            <div className="pickorders__controls">
              <label className="pickorders__control">
                <span className="text-2xs muted">Ekipman</span>
                <Segmented
                  label="Ekipman"
                  value={equipment}
                  options={EQUIPMENT_OPTIONS}
                  onChange={setEquipment}
                />
              </label>

              <label className="pickorders__control">
                <span className="text-2xs muted">Hedef</span>
                <Segmented
                  label="Optimizasyon hedefi"
                  value={objective}
                  options={OBJECTIVE_OPTIONS}
                  onChange={setObjective}
                />
              </label>

              <label className="pickorders__control">
                <span className="text-2xs muted">Toplayıcı sayısı</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={vehicleCount}
                  onChange={(event) =>
                    setVehicleCount(Math.max(1, Number(event.target.value) || 1))
                  }
                />
              </label>

              <button
                type="button"
                className="btn btn--primary"
                onClick={optimize}
                disabled={busy || !active}
              >
                {busy ? "Çözülüyor…" : "Turları optimize et"}
              </button>
            </div>

            {error ? <Note tone="danger">{error}</Note> : null}

            {skipped.length > 0 ? (
              <Note tone="warning">
                {skipped.length} satır tura alınamadı: {skipped[0].skuCode} —{" "}
                {skipped[0].reason}
              </Note>
            ) : null}

            {plan ? (
              <>
                <MetricStrip metrics={metrics} />
                {!plan.calibrated ? (
                  <Note tone="warning">
                    Süre modeli <strong>kalibre değil</strong> ({plan.modelVersion}).
                    Gösterilen süreler tahmindir; gerçek görev olayları geldikçe
                    kalibre edilir.
                  </Note>
                ) : null}
                <p className="text-2xs muted">
                  {plan.solverVersion} · çözüm kalitesi{" "}
                  <strong>{plan.solutionQuality}</strong> — kanıtlanmış optimum
                  iddia edilmez.
                </p>
              </>
            ) : (
              <p className="text-xs muted">
                Bu sipariş için henüz tur üretilmedi.
              </p>
            )}
          </Panel>

          {plan
            ? plan.tours.map((tour) => (
                <TourPanel key={tour.id} tour={tour} orderCode={plan.orderCode} />
              ))
            : null}

          {detail ? <LinesPanel detail={detail} /> : null}
        </div>
      </div>
    </div>
  );
}

/** Tek bir turun sırası ve süre ayrışımı. */
function TourPanel({ tour, orderCode }: { tour: PickTourView; orderCode: string }) {
  const pickSec = tour.stops.reduce((sum, stop) => sum + stop.pickSec, 0);
  const travelSec = tour.stops.reduce(
    (sum, stop) => sum + stop.travelSec + stop.congestionSec,
    0,
  );

  return (
    <Panel
      title={`Tur ${tour.seq}`}
      note={
        <span className="text-2xs muted">
          {tour.stops.length} durak · {Math.round(tour.totalDistanceM)} m ·{" "}
          {minutes(tour.estimatedSec)} · {tour.volumeUsedM3.toFixed(3)} m³
        </span>
      }
      action={
        <Link className="btn" to={`/twin/3d?tour=${tour.id}&order=${orderCode}`}>
          3B'de izle
        </Link>
      }
    >
      <div className="pickorders__split" aria-hidden="true">
        <span
          style={{ flex: Math.max(1, travelSec), background: "var(--blue-600)" }}
          title={`Yürüme ${minutes(travelSec)}`}
        />
        <span
          style={{ flex: Math.max(1, pickSec), background: "var(--teal-600)" }}
          title={`Toplama ${minutes(pickSec)}`}
        />
      </div>
      <p className="text-2xs muted">
        Yürüme {minutes(travelSec)} · toplama {minutes(pickSec)} · hazırlık ve
        bırakma {minutes(tour.estimatedSec - travelSec - pickSec)}
      </p>

      <ol className="pickorders__stops">
        {tour.stops.map((stop) => (
          <li key={stop.seq}>
            <span className="pickorders__seq">{stop.seq}</span>
            <span className="pickorders__loc">{stop.locationCode}</span>
            <span className="pickorders__sku">
              {stop.skuCode} × {stop.quantity}
            </span>
            <span className="pickorders__time">{minutes(stop.cumulativeSec)}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function LinesPanel({ detail }: { detail: PickOrderDetail }) {
  const missing = detail.lines.filter((line) => !line.locationCode);

  return (
    <Panel title="Sipariş satırları">
      {missing.length > 0 ? (
        <Note tone="warning">
          {missing.length} satırın aktif pick gözü yok; bu satırlar tura giremez.
        </Note>
      ) : null}
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>SKU</th>
            <th>Ad</th>
            <th>Miktar</th>
            <th>Göz</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.lineNo}>
              <td>{line.lineNo}</td>
              <td className="mono">{line.skuCode}</td>
              <td>{line.skuName}</td>
              <td>
                {line.quantity} {line.uom}
              </td>
              <td className="mono">{line.locationCode ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
