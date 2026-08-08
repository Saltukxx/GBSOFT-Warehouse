import type { ComponentProps } from "react";
import { WarehouseMap } from "./WarehouseMap";
import type { LayoutState } from "../../data/useLayout";
import { Note } from "../ui/primitives";

/**
 * Haritanın yükleme ve hata durumlarını üstlenen sarmalayıcı.
 *
 * Dijital ikiz gelmeden harita çizilemez; placeholder gerçek bileşenin
 * geometrisine uyar, bütün sayfa iskelete dönmez (§19.1).
 */

type MapProps = ComponentProps<typeof WarehouseMap>;

type Props = Omit<MapProps, "layout" | "layers" | "locations"> & {
  twin: LayoutState;
};

export function MapSurface({ twin, ...mapProps }: Props) {
  if (twin.status === "error") {
    return (
      <div className="map map--message">
        <Note tone="danger">
          Depo yerleşimi yüklenemedi.{" "}
          {twin.error?.message ?? "Bilinmeyen hata."}
        </Note>
        <button
          type="button"
          className="btn"
          onClick={twin.retry}
          style={{ marginTop: "var(--space-3)", alignSelf: "flex-start" }}
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  if (twin.status === "loading" || !twin.layout) {
    return (
      <div className="map map--message" aria-busy="true">
        <div className="map__placeholder" aria-hidden="true">
          <svg viewBox="0 0 1000 452" width="100%" height="100%">
            {Array.from({ length: 12 }, (_, aisle) =>
              Array.from({ length: 8 }, (_, cell) => (
                <rect
                  key={`${aisle}-${cell}`}
                  x={40 + aisle * 76 + (cell % 2) * 48}
                  y={40 + Math.floor(cell / 2) * 68 + (cell >= 4 ? 26 : 0)}
                  width={28}
                  height={62}
                  rx={2}
                  fill="var(--surface-2)"
                />
              )),
            )}
          </svg>
        </div>
        <span className="text-xs muted">Depo yerleşimi yükleniyor…</span>
      </div>
    );
  }

  return (
    <WarehouseMap
      layout={twin.layout}
      layers={twin.layers}
      locations={twin.locations}
      {...mapProps}
    />
  );
}
