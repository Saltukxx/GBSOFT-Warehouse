import type { ComponentKey, PickTimeBreakdown } from "../../domain/picking";
import { COMPONENT_FIELD, PICK_TIME_COMPONENTS } from "../../domain/picking";
import { num } from "../../lib/format";

/**
 * Yatay stacked time bar (§7.3).
 * Bileşenler klavye veya fare ile seçilebilir; seçim alt analizi günceller.
 */

type Props = {
  breakdown: PickTimeBreakdown;
  selected: ComponentKey | null;
  onSelect: (key: ComponentKey | null) => void;
};

export function TimeDecompositionBar({ breakdown, selected, onSelect }: Props) {
  const total = breakdown.p50Sec;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--space-5)",
          marginBottom: "var(--space-3)",
        }}
      >
        <div>
          <div className="text-xs muted">Toplam P50</div>
          <div
            className="num"
            style={{ fontSize: "var(--text-2xl)", fontWeight: 600 }}
          >
            {num(breakdown.p50Sec, 1)}{" "}
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 400 }}>
              sn/line
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs muted">P90</div>
          <div
            className="num"
            style={{ fontSize: "var(--text-xl)", fontWeight: 600 }}
          >
            {num(breakdown.p90Sec, 1)}{" "}
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 400 }}>
              sn/line
            </span>
          </div>
        </div>
        <div className="text-xs subtle" style={{ marginLeft: "auto" }}>
          Bileşenlerin toplamı P50'ye eşittir · son 14 vardiya
        </div>
      </div>

      <div
        style={{ display: "flex", height: 44, gap: 2 }}
        role="group"
        aria-label="Picking süresi bileşenleri"
      >
        {PICK_TIME_COMPONENTS.map((c) => {
          const value = breakdown[COMPONENT_FIELD[c.key]];
          const isSelected = selected === c.key;
          const dim = selected !== null && !isSelected;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSelect(isSelected ? null : c.key)}
              aria-pressed={isSelected}
              title={`${c.label}: ${num(value, 1)} sn`}
              style={{
                flex: `${value} 0 0`,
                minWidth: 28,
                background: c.color,
                opacity: dim ? 0.32 : 1,
                border: 0,
                outline: isSelected ? "2px solid var(--ink-950)" : "none",
                outlineOffset: 1,
                borderRadius: 2,
                color: "#ffffff",
                fontSize: "var(--text-xs)",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
                cursor: "pointer",
                transition: "opacity var(--dur-fast) var(--ease)",
                display: "grid",
                placeItems: "center",
                padding: 0,
              }}
            >
              {num(value, 0)}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          gap: 2,
          marginTop: 5,
        }}
      >
        {PICK_TIME_COMPONENTS.map((c) => {
          const value = breakdown[COMPONENT_FIELD[c.key]];
          return (
            <div
              key={c.key}
              style={{
                flex: `${value} 0 0`,
                minWidth: 28,
                fontSize: "var(--text-2xs)",
                color:
                  selected === c.key ? "var(--ink-950)" : "var(--ink-600)",
                fontWeight: selected === c.key ? 600 : 400,
                textAlign: "center",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.label}
            </div>
          );
        })}
      </div>

      {/* Grafiğin tablo alternatifi (§18) */}
      <details style={{ marginTop: "var(--space-3)" }}>
        <summary
          className="text-xs"
          style={{ cursor: "pointer", color: "var(--blue-700)" }}
        >
          Bileşen değerlerini tablo olarak göster
        </summary>
        <table
          className="table table--compact"
          style={{ marginTop: "var(--space-2)", maxWidth: 420 }}
        >
          <caption className="sr-only">
            Picking süresi bileşenlerinin saniye değerleri
          </caption>
          <thead>
            <tr>
              <th scope="col">Bileşen</th>
              <th scope="col" className="num">
                Süre
              </th>
              <th scope="col" className="num">
                Pay
              </th>
            </tr>
          </thead>
          <tbody>
            {PICK_TIME_COMPONENTS.map((c) => {
              const value = breakdown[COMPONENT_FIELD[c.key]];
              return (
                <tr key={c.key}>
                  <th scope="row" style={{ fontWeight: 400 }}>
                    {c.label}
                  </th>
                  <td className="num mono">{num(value, 1)} sn</td>
                  <td className="num mono">
                    {num((value / total) * 100, 0)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}
