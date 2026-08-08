import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { num } from "../../lib/format";

/* ------------------------------------------------------------------ */
/* MetricStrip — §11.2                                                 */
/* ------------------------------------------------------------------ */

export type Metric = {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "positive" | "negative" | "warning" | "neutral";
  context: string;
};

export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="metricstrip">
      {metrics.map((m) => (
        <div className="metricstrip__item" key={m.label}>
          <div className="metricstrip__label">{m.label}</div>
          <div className="metricstrip__value">
            <span>{m.value}</span>
            {m.delta ? (
              <span
                className={`metricstrip__delta tone-${m.deltaTone ?? "neutral"}`}
              >
                {m.delta}
              </span>
            ) : null}
          </div>
          <div className="metricstrip__context">{m.context}</div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StatusTag — §11.5                                                   */
/* ------------------------------------------------------------------ */

const TAG_VARIANT: Record<string, string> = {
  hazır: "ready",
  bekliyor: "waiting",
  bloklu: "blocked",
  uygulandı: "applied",
  yayınlandı: "applied",
  "veri eksik": "missing",
  önerilen: "applied",
  alternatif: "info",
  "uygun değil": "blocked",
  kilitli: "info",
  sağlıklı: "ready",
  uyarı: "missing",
};

export function StatusTag({ status }: { status: string }) {
  const variant = TAG_VARIANT[status.toLowerCase()] ?? "info";
  return (
    <span className={`tag tag--${variant}`}>
      <span className="tag__dot" aria-hidden="true" />
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* DeltaValue — §11.6                                                  */
/* ------------------------------------------------------------------ */

export type DeltaValueProps = {
  current: number;
  previous?: number;
  unit: string;
  direction: "lower-is-better" | "higher-is-better";
  precision?: number;
  /** Yön oku ve "iyileşme/bozulma" metni gösterilsin mi? */
  withWord?: boolean;
};

export function DeltaValue({
  current,
  previous,
  unit,
  direction,
  precision = 1,
  withWord = true,
}: DeltaValueProps) {
  const change = previous === undefined ? current : current - previous;
  const improving =
    direction === "lower-is-better" ? change < 0 : change > 0;
  const neutral = Math.abs(change) < 1e-9;

  const tone = neutral ? "neutral" : improving ? "positive" : "negative";
  const word = neutral ? "değişmedi" : improving ? "iyileşme" : "bozulma";
  const arrow = neutral ? "→" : change < 0 ? "↓" : "↑";
  const sign = current > 0 ? "+" : "";

  return (
    <span className={`delta tone-${tone}`}>
      <span aria-hidden="true" className="delta__arrow">
        {arrow}
      </span>
      <span>
        {sign}
        {num(current, precision)}
        {unit}
      </span>
      {withWord ? <span className="delta__word">{word}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  note,
  action,
  children,
  flush,
  className,
}: {
  title?: string;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`panel${className ? ` ${className}` : ""}`}>
      {title ? (
        <div className="panel__head">
          <h2 className="panel__title">{title}</h2>
          {action}
          {note ? <div className="panel__note">{note}</div> : null}
        </div>
      ) : null}
      <div className={`panel__body${flush ? " panel__body--flush" : ""}`}>
        {children}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                   */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="segmented__item"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notlar                                                              */
/* ------------------------------------------------------------------ */

export function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "danger" | "positive" | "neutral";
  children: ReactNode;
}) {
  const icon =
    tone === "warning" || tone === "danger"
      ? "alert"
      : tone === "positive"
        ? "check"
        : "info";
  return (
    <p className={`note${tone === "neutral" ? "" : ` note--${tone}`}`}>
      <Icon name={icon} size={14} />
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* ConfidenceIndicator — §11.7                                         */
/* ------------------------------------------------------------------ */

export function ConfidenceIndicator({
  label,
  valuePct,
  detail,
}: {
  label: string;
  valuePct: number;
  detail?: string;
}) {
  return (
    <div>
      <div className="row row--between">
        <span className="text-xs muted">{label}</span>
        <span className="mono text-xs">{num(valuePct, 0)}%</span>
      </div>
      <div className="coverage__track" style={{ marginTop: 3 }}>
        <div
          className={`coverage__fill${valuePct < 95 ? " coverage__fill--warn" : ""}`}
          style={{ width: `${Math.min(100, valuePct)}%` }}
        />
      </div>
      {detail ? (
        <div className="text-xs subtle" style={{ marginTop: 2 }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Boş / yükleniyor / hata durumları — §19                             */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="table__empty">
      <div style={{ fontWeight: 500, color: "var(--ink-900)" }}>{title}</div>
      <div style={{ marginTop: 4 }}>{hint}</div>
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}

export function Skeleton({
  height,
  width = "100%",
}: {
  height: number;
  width?: number | string;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        height,
        width,
        background: "var(--surface-2)",
        border: "1px solid var(--line-subtle)",
        borderRadius: "var(--radius-sm)",
      }}
    />
  );
}
