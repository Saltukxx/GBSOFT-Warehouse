import { useEffect, useRef, useState } from "react";
import { Modal } from "../../components/ui/Overlay";
import { Note } from "../../components/ui/primitives";
import type {
  ObjectiveWeights,
  ReoptimizeRequest,
  ReoptimizeResponse,
} from "@gbsoft/domain";
import { PROFILE_PRESETS, SOLVER_STEPS } from "@gbsoft/domain";
import type { ObjectiveProfile } from "@gbsoft/domain";
import type { ZoneId } from "@gbsoft/domain";
import { reoptimize } from "../../data/api";
import { num, pct } from "../../lib/format";

/**
 * "Yeniden optimize et" modalı (§8.7).
 * Sınırlı sayıda parametre; sahte "AI düşünüyor" metni yoktur, gerçek
 * solver aşamaları gösterilir. Süre 1,4-2,2 sn arasında deterministiktir.
 */

const ZONES: ZoneId[] = ["A", "B", "C", "D"];
const STEP_MS = 340;

type Props = {
  planId: string;
  lockedAssignments: ReoptimizeRequest["lockedAssignments"];
  excludedSkuIds: string[];
  blockedLocationIds: string[];
  onClose: () => void;
  onResult: (response: ReoptimizeResponse) => void;
};

export function OptimizerModal({
  planId,
  lockedAssignments,
  excludedSkuIds,
  blockedLocationIds,
  onClose,
  onResult,
}: Props) {
  const [profile, setProfile] = useState<ObjectiveProfile>("balanced");
  const [weights, setWeights] = useState<ObjectiveWeights>(
    PROFILE_PRESETS.balanced.weights,
  );
  const [moveBudget, setMoveBudget] = useState(
    PROFILE_PRESETS.balanced.moveBudget,
  );
  const [minNetBenefit, setMinNetBenefit] = useState(1.5);
  const [frozenZones, setFrozenZones] = useState<ZoneId[]>([]);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<ReoptimizeResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  function applyProfile(next: ObjectiveProfile) {
    setProfile(next);
    setWeights(PROFILE_PRESETS[next].weights);
    setMoveBudget(PROFILE_PRESETS[next].moveBudget);
  }

  function updateWeight(key: keyof ObjectiveWeights, value: number) {
    setWeights((w) => ({ ...w, [key]: value }));
  }

  // Çalıştırma başlayınca ve sonuç gelince ilerleme bölümü görünür olur.
  useEffect(() => {
    if (step < 0) return;
    const body = progressRef.current?.closest(".modal__body");
    if (body) body.scrollTop = body.scrollHeight;
  }, [step, result]);

  // Solver aşamaları — sabit aralıkla ilerler.
  useEffect(() => {
    if (!running) return;
    if (step >= SOLVER_STEPS.length - 1) return;
    const timer = window.setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [running, step]);

  async function run() {
    setRunning(true);
    setStep(0);
    setResult(null);
    setFailure(null);

    const request: ReoptimizeRequest = {
      planId,
      profile,
      weights,
      moveBudget,
      minNetBenefitPct: minNetBenefit,
      lockedAssignments,
      excludedSkuIds,
      blockedLocationIds,
      frozenZones,
    };

    try {
      const [response] = await Promise.all([
        reoptimize(request),
        new Promise((resolve) =>
          window.setTimeout(resolve, STEP_MS * SOLVER_STEPS.length),
        ),
      ]);
      setStep(SOLVER_STEPS.length - 1);
      setResult(response);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Optimizasyon çalıştırılamadı.",
      );
    } finally {
      setRunning(false);
    }
  }

  const budgetTooLow = moveBudget < 12;

  return (
    <Modal
      title="Yeniden optimize et"
      subtitle={`Plan ${planId} · solver slot-cp-2.3.0`}
      onClose={onClose}
      footer={
        result?.status === "feasible" ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                onResult(result);
                onClose();
              }}
            >
              Sonucu plana uygula
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Kapat
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={run}
              disabled={running}
            >
              {running ? "Çalışıyor…" : "Planı çalıştır"}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Vazgeç
            </button>
            <span className="text-xs muted" style={{ marginLeft: "auto" }}>
              {lockedAssignments.length} kilitli atama ·{" "}
              {excludedSkuIds.length} plan dışı SKU
            </span>
          </>
        )
      }
    >
      <div className="stack stack-5">
        {result ? (
          <section>
            <h3 className="section-label">Kullanılan parametreler</h3>
            <dl className="deflist" style={{ marginTop: 4 }}>
              <dt>Amaç profili</dt>
              <dd>{PROFILE_PRESETS[profile].label}</dd>
              <dt>Ağırlıklar</dt>
              <dd className="mono">
                {num(weights.pickingTime, 2)} / {num(weights.replenishment, 2)} /{" "}
                {num(weights.congestion, 2)}
              </dd>
              <dt>Move budget</dt>
              <dd className="mono">{moveBudget}</dd>
              <dt>Minimum net fayda</dt>
              <dd className="mono">%{num(minNetBenefit, 1)}</dd>
              <dt>Freeze zone</dt>
              <dd>{frozenZones.length === 0 ? "yok" : frozenZones.join(", ")}</dd>
              <dt>Kilitli atama</dt>
              <dd>{lockedAssignments.length}</dd>
            </dl>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              style={{ marginTop: 6 }}
              onClick={() => {
                setResult(null);
                setStep(-1);
              }}
            >
              Parametreleri değiştir ve yeniden çalıştır
            </button>
          </section>
        ) : null}

        <section hidden={Boolean(result)}>
          <h3 className="section-label">Amaç profili</h3>
          <div className="optprofiles">
            {(Object.keys(PROFILE_PRESETS) as ObjectiveProfile[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`optprofile${profile === key ? " is-active" : ""}`}
                onClick={() => applyProfile(key)}
                aria-pressed={profile === key}
              >
                <strong>{PROFILE_PRESETS[key].label}</strong>
                <span>{PROFILE_PRESETS[key].description}</span>
              </button>
            ))}
          </div>
        </section>

        <section hidden={Boolean(result)}>
          <h3 className="section-label">Ağırlıklar</h3>
          <div className="stack stack-3" style={{ marginTop: 6 }}>
            <WeightRow
              label="Picking time"
              hint="Toplama süresine verilen ağırlık"
              value={weights.pickingTime}
              onChange={(v) => updateWeight("pickingTime", v)}
            />
            <WeightRow
              label="Replenishment"
              hint="Yeniden besleme maliyeti"
              value={weights.replenishment}
              onChange={(v) => updateWeight("replenishment", v)}
            />
            <WeightRow
              label="Congestion"
              hint="Koridor yoğunluğu cezası"
              value={weights.congestion}
              onChange={(v) => updateWeight("congestion", v)}
            />
          </div>
        </section>

        <section className="grid-2" hidden={Boolean(result)}>
          <label className="field">
            <span className="field__label">Move budget</span>
            <input
              className="input"
              type="number"
              min={4}
              max={60}
              value={moveBudget}
              onChange={(e) => setMoveBudget(Number(e.target.value))}
            />
            <span className="field__hint">
              Üretilecek taşıma görevi üst sınırı
            </span>
          </label>
          <label className="field">
            <span className="field__label">Minimum net fayda</span>
            <input
              className="input"
              type="number"
              step={0.5}
              min={0}
              max={10}
              value={minNetBenefit}
              onChange={(e) => setMinNetBenefit(Number(e.target.value))}
            />
            <span className="field__hint">
              Bu eşiğin altındaki öneriler plana alınmaz (%)
            </span>
          </label>
        </section>

        <section hidden={Boolean(result)}>
          <h3 className="section-label">Freeze zone</h3>
          <div className="row" style={{ marginTop: 6, gap: "var(--space-4)" }}>
            {ZONES.map((zone) => (
              <label className="checkbox-row" key={zone}>
                <input
                  type="checkbox"
                  checked={frozenZones.includes(zone)}
                  onChange={() =>
                    setFrozenZones((prev) =>
                      prev.includes(zone)
                        ? prev.filter((z) => z !== zone)
                        : [...prev, zone],
                    )
                  }
                />
                Zone {zone}
              </label>
            ))}
          </div>
          <p className="field__hint" style={{ marginTop: 4 }}>
            Dondurulan zonlarda mevcut yerleşim değiştirilmez.
          </p>
        </section>

        {budgetTooLow ? (
          <Note tone="warning">
            Move budget 12'nin altında. Bu değerle uygulanabilir plan
            bulunamayabilir.
          </Note>
        ) : null}

        {failure ? <Note tone="danger">{failure}</Note> : null}

        {step >= 0 ? (
          <section ref={progressRef}>
            <h3 className="section-label">Çalıştırma durumu</h3>
            <ol className="solversteps" aria-live="polite">
              {SOLVER_STEPS.map((label, index) => (
                <li
                  key={label}
                  className={
                    index < step
                      ? "is-done"
                      : index === step
                        ? "is-active"
                        : "is-pending"
                  }
                >
                  <span className="solversteps__mark" aria-hidden="true">
                    {index < step ? "✓" : index === step ? "•" : "○"}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {result?.status === "feasible" ? (
          <section>
            <h3 className="section-label">Sonuç</h3>
            <dl className="deflist" style={{ marginTop: 4 }}>
              <dt>Durum</dt>
              <dd>Uygulanabilir (feasible)</dd>
              <dt>Plan</dt>
              <dd className="mono">{result.planId}</dd>
              <dt>Run</dt>
              <dd className="mono">{result.runId}</dd>
              <dt>Net etki</dt>
              <dd>{pct(result.objectiveDeltaPct)}</dd>
              <dt>Taşıma görevi</dt>
              <dd>{result.moveTaskCount}</dd>
              <dt>Hard constraint ihlali</dt>
              <dd>{result.hardViolations}</dd>
              <dt>Çözüm süresi</dt>
              <dd className="mono">{num(result.solveDurationMs)} ms</dd>
            </dl>
            <Note tone="neutral">
              Solver zaman sınırına ulaşmadı; sonuç feasible olarak
              raporlanıyor. OPTIMAL iddiası yapılmaz.
            </Note>
          </section>
        ) : null}

        {result?.status === "infeasible" ? (
          <section>
            <h3 className="section-label">Uygulanabilir plan bulunamadı</h3>
            <ul className="text-sm" style={{ margin: "6px 0 0 18px" }}>
              {result.infeasibilityReasons?.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <h3 className="section-label" style={{ marginTop: 12 }}>
              Denenebilecek gevşetmeler
            </h3>
            <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setMoveBudget(26)}
              >
                Move budget'ı artır
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setFrozenZones([])}
              >
                Alternatif zonlara izin ver
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setStep(-1);
                  setResult(null);
                }}
              >
                Kilitleri incele
              </button>
            </div>
          </section>
        ) : null}

        {result?.status === "timeout" || result?.status === "failed" ? (
          <Note tone="danger">
            {result.status === "timeout"
              ? "Zaman sınırında uygulanabilir çözüm bulunamadı. Zaman sınırını veya kısıtları gözden geçirin."
              : "Optimizasyon servisi çalıştırmayı tamamlayamadı. Çalıştırma kaydı hata ayrıntısıyla saklandı."}
          </Note>
        ) : null}
      </div>
    </Modal>
  );
}

function WeightRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="row row--between">
        <span className="text-sm">{label}</span>
        <span className="mono text-xs">{num(value, 2)}</span>
      </div>
      <input
        className="slider"
        type="range"
        min={0}
        max={1.5}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} ağırlığı`}
      />
      <div className="field__hint">{hint}</div>
    </div>
  );
}
