import { useMemo } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { MetricStrip, Note, Panel } from "../../components/ui/primitives";
import { detectWebgl } from "../../components/warehouse-3d/webgl";
import { ExecutionPanel } from "./ExecutionPanel";
import { InstructionSheetPanel } from "./InstructionSheet";
import { LoadViewer } from "./LoadViewer";
import { PlanHeaderPanel } from "./PlanHeaderPanel";
import { AxleBalancePanel, LoadSequenceList, PlacementEditor } from "./PlanInspector";
import { ShipmentList } from "./ShipmentList";
import { useLoadStudio } from "./useLoadStudio";
import "./loadstudio.css";

/**
 * Rota-duyarlı araç yükleme çalışma alanı.
 *
 * Sevkiyat seçimi, 3B yerleşim, yerleşim editörü ve shadow yürütme aynı
 * ekranda durur — plan üretmek, düzeltmek ve yüklemeyi teyit etmek tek bir
 * işin adımlarıdır ve ekran değiştirmek bağlamı kopartır. Durum ve eylemler
 * `useLoadStudio`'da; burada yalnız yerleşim var.
 */
export function LoadStudioPage() {
  const webgl = useMemo(() => detectWebgl(), []);
  const studio = useLoadStudio();
  const { shipments, vehicles, plans, execution, instructions, plan } = studio;

  if (shipments.status === "error" || vehicles.status === "error") {
    const error =
      shipments.status === "error"
        ? shipments.error
        : vehicles.status === "error"
          ? vehicles.error
          : null;
    return (
      <div className="page">
        <PageHeader
          eyebrow="Outbound"
          title="Load Studio"
          description="Rota-duyarlı 3B araç yükleme."
        />
        <div className="page__body">
          <Note tone="danger">Veri yüklenemedi. {error?.message}</Note>
        </div>
      </div>
    );
  }

  const shipmentList = shipments.status === "ready" ? shipments.data : [];
  const vehicleList = vehicles.status === "ready" ? vehicles.data : [];
  const planList = plans.status === "ready" ? plans.data : [];
  const lockedCount = plan?.placements.filter((placement) => placement.locked).length ?? 0;

  return (
    <div className="page loadstudio">
      <PageHeader
        eyebrow="Outbound"
        title="Load Studio"
        description="Aracı rota sırasına göre doldurun; aks yükünü, ağırlık merkezini ve her duraktaki erişimi birlikte doğrulayın."
        context={
          <span className="tag">
            {webgl.supported ? "3B etkin" : "2B güvenli görünüm"}
          </span>
        }
      />

      <div className="page__body loadstudio__layout">
        <aside className="loadstudio__shipments">
          <ShipmentList
            shipments={shipmentList}
            selectedId={studio.shipmentId}
            loaded={shipments.status === "ready"}
            onSelect={studio.setShipmentId}
          />
        </aside>

        <div className="loadstudio__main">
          <PlanHeaderPanel
            shipment={studio.shipment.data ?? null}
            plans={planList}
            plansError={plans.status === "error" ? plans.error : null}
            plansLoaded={plans.status === "ready"}
            activePlanId={plan?.id ?? null}
            vehicles={vehicleList}
            vehicleCode={studio.vehicleCode}
            hasShipment={Boolean(studio.shipmentId)}
            lockedCount={lockedCount}
            busy={studio.busy}
            message={studio.message}
            onVehicleChange={studio.setVehicleCode}
            onOptimize={() => void studio.optimize()}
            onSelectPlan={studio.setPlanId}
          />

          {plan ? (
            <>
              <MetricStrip
                metrics={[
                  {
                    label: "Hacim doluluğu",
                    value: `%${plan.volumeUtilizationPct.toFixed(1)}`,
                    context: "Araç iç hacmine göre.",
                  },
                  {
                    label: "Toplam yük",
                    value: `${plan.payloadKg.toFixed(1)} kg`,
                    context:
                      plan.weightDistribution.maxCombinationKg === null
                        ? `${plan.vehicle.maxPayloadKg.toFixed(0)} kg kapasite.`
                        : `Katar ${plan.weightDistribution.combinationKg.toFixed(0)} / ${plan.weightDistribution.maxCombinationKg.toFixed(0)} kg.`,
                  },
                  {
                    label: "Yeniden elleçleme",
                    value: String(plan.rehandlingRiskCount),
                    context: "Durak erişim riski.",
                  },
                  {
                    label: "Kilitli birim",
                    value: String(lockedCount),
                    context: "Warm-start'ta korunur.",
                  },
                ]}
              />

              <div className="loadstudio__workspace">
                <LoadViewer
                  plan={plan}
                  webglSupported={webgl.supported}
                  selectedHuCode={studio.selectedHuCode}
                  visibleThroughSeq={studio.visibleThroughSeq}
                  maxSeq={studio.maxSeq}
                  playing={studio.playing}
                  sectionView={studio.sectionView}
                  onSelect={studio.setSelectedHuCode}
                  onToggleSection={studio.toggleSection}
                  onTogglePlay={studio.togglePlay}
                  onSeek={studio.seek}
                />

                <aside className="loadstudio__rail">
                  <AxleBalancePanel plan={plan} />
                  <PlacementEditor
                    plan={plan}
                    placement={studio.selectedPlacement}
                    draft={studio.draft}
                    busy={studio.busy}
                    onDraftChange={studio.setDraft}
                    onSavePosition={studio.savePosition}
                    onRotate={studio.rotate}
                    onToggleLock={studio.toggleLock}
                  />
                  <LoadSequenceList
                    plan={plan}
                    selectedHuCode={studio.selectedHuCode}
                    onSelect={studio.selectFromSequence}
                  />
                </aside>
              </div>

              <section
                className="loadstudio__execution-grid"
                aria-label="Yükleme execution"
              >
                <ExecutionPanel
                  plan={plan}
                  execution={execution.status === "ready" ? execution.data : null}
                  error={execution.status === "error" ? execution.error : null}
                  loaded={execution.status === "ready"}
                  busy={studio.busy}
                  scanCode={studio.scanCode}
                  scanOutcome={studio.scanOutcome}
                  onScanCodeChange={studio.setScanCode}
                  onScanOutcomeChange={studio.setScanOutcome}
                  onPublish={() => void studio.shadowPublish()}
                  onSubmitScan={() => void studio.submitScan()}
                  onDeviationReplan={() => void studio.deviationReplan()}
                />
                <InstructionSheetPanel
                  sheet={instructions.status === "ready" ? instructions.data : null}
                  error={instructions.status === "error" ? instructions.error : null}
                />
              </section>

              {plan.violations.length > 0 ? (
                <Panel title={`Doğrulama ihlalleri · ${plan.violations.length}`}>
                  <ul className="loadstudio__violations">
                    {plan.violations.map((violation, index) => (
                      <li key={`${violation.code}-${index}`}>
                        <strong>{violation.code}</strong>
                        <span>{violation.message}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : (
                <Note tone="positive">
                  Plan; araç sınırı, kapı, engel, çakışma, toplam/aks yükü, CoG ve durak
                  erişimi kontrollerinden geçti.
                </Note>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
