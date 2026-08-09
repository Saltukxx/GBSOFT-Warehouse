import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./AppShell";
import { OverviewPage } from "../features/operations/OverviewPage";
import { TimeIntelligencePage } from "../features/picking-time/TimeIntelligencePage";
import { SlottingStudioPage } from "../features/slotting/SlottingStudioPage";
import { PlanHistoryPage } from "../features/slotting/PlanHistoryPage";
import { MovePlanPage } from "../features/move-plan/MovePlanPage";
import { DataQualityPage } from "../features/data-quality/DataQualityPage";
import { ImportsPage } from "../features/imports/ImportsPage";
import { LayoutEditorPage } from "../features/layout-editor/LayoutEditorPage";
import { Twin3DPage } from "../features/twin-3d/Twin3DPage";
import { PlaceholderPage } from "../features/placeholder/PlaceholderPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/operations" replace /> },
      { path: "operations", element: <OverviewPage /> },
      {
        path: "operations/picking",
        element: (
          <PlaceholderPage
            eyebrow="Operasyon"
            title="Picking Control"
            purpose="Aktif wave ve görev kuyruğunun canlı yönetimi; picker atama ve sapma çözümü."
            questions={[
              "Hangi wave SLA riski taşıyor ve nedeni ne?",
              "Hangi picker hangi zonda, iş yükü dengeli mi?",
              "Açık exception'lar hangi neden koduyla geldi?",
            ]}
            actions={[
              "Görev yeniden atama",
              "Wave önceliklendirme",
              "Exception çözümü ve yeniden optimizasyon isteği",
            ]}
            relatedTo={{ label: "Operasyon genel bakış", to: "/operations" }}
          />
        ),
      },
      {
        path: "operations/exceptions",
        element: (
          <PlaceholderPage
            eyebrow="Operasyon"
            title="İstisnalar"
            purpose="Tüm açık istisnaların tek listesi; etki, güven ve sorumlu ile birlikte."
            questions={[
              "Şu an hangi istisna en yüksek etkiye sahip?",
              "İstisna hangi fiziksel olaydan üretildi?",
              "Aynı neden kodu tekrar ediyor mu?",
            ]}
            actions={["Sahiplen", "Çözüm kaydet", "Kök nedene git"]}
            relatedTo={{ label: "Müdahale kuyruğunu aç", to: "/operations" }}
          />
        ),
      },
      { path: "twin/3d", element: <Twin3DPage /> },
      { path: "optimization/slotting", element: <SlottingStudioPage /> },
      {
        path: "optimization/slotting/:planId",
        element: <SlottingStudioPage />,
      },
      { path: "optimization/moves", element: <MovePlanPage /> },
      { path: "optimization/moves/:planId", element: <MovePlanPage /> },
      { path: "optimization/history", element: <PlanHistoryPage /> },
      { path: "analysis/time", element: <TimeIntelligencePage /> },
      {
        path: "analysis/sku",
        element: (
          <PlaceholderPage
            eyebrow="Analiz"
            title="SKU analizi"
            purpose="SKU bazında hız, birlikte toplanma, replenishment ve fiziksel veri kalitesi."
            questions={[
              "Bu SKU hangi SKU'larla birlikte toplanıyor?",
              "Hız sınıfı ile lokasyonu uyumlu mu?",
              "Ölçü verisi güncel mi?",
            ]}
            actions={[
              "Slot önerisi iste",
              "Ölçüm görevi aç",
              "Affinity grubunu incele",
            ]}
            relatedTo={{
              label: "Slotting Studio'ya git",
              to: "/optimization/slotting",
            }}
          />
        ),
      },
      {
        path: "analysis/locations",
        element: (
          <PlaceholderPage
            eyebrow="Analiz"
            title="Lokasyon analizi"
            purpose="Göz bazında doluluk, erişim, congestion ve kapasite marjı."
            questions={[
              "Hangi gözler kronik olarak yavaş?",
              "Kapasite marjı hangi gözlerde kritik?",
              "Bloklu gözlerin operasyona etkisi ne?",
            ]}
            actions={["Gözü yasakla", "Bakım kaydı aç", "Kapasiteyi doğrula"]}
            relatedTo={{
              label: "Depo haritasını aç",
              to: "/optimization/slotting",
            }}
          />
        ),
      },
      { path: "system/imports", element: <ImportsPage /> },
      { path: "system/layout", element: <LayoutEditorPage /> },
      { path: "data-quality", element: <DataQualityPage /> },
      {
        path: "system/integrations",
        element: (
          <PlaceholderPage
            eyebrow="Sistem"
            title="Entegrasyonlar"
            purpose="WMS, master data ve olay akışlarının bağlantı, yetki ve sağlık yönetimi."
            questions={[
              "Hangi konektör hangi veriyi hangi sıklıkla getiriyor?",
              "Write-back yetkisi hangi alanlarda açık?",
              "Son hata ve yeniden deneme durumu ne?",
            ]}
            actions={["Bağlantı testi", "Alan eşleme", "Write-back yetkisi"]}
            relatedTo={{ label: "Veri kalitesini aç", to: "/data-quality" }}
          />
        ),
      },
      {
        path: "system/model",
        element: (
          <PlaceholderPage
            eyebrow="Sistem"
            title="Model ve solver"
            purpose="Tahmin modeli ve solver sürümlerinin performansı, eşikleri ve rollback yönetimi."
            questions={[
              "Aktif model sürümü hangi dönemle eğitildi?",
              "Solve time ve gap dağılımı nasıl?",
              "Input drift var mı?",
            ]}
            actions={["Sürüm yayınla", "Eşik güncelle", "Önceki sürüme dön"]}
            relatedTo={{
              label: "Plan geçmişini aç",
              to: "/optimization/history",
            }}
          />
        ),
      },
      {
        path: "*",
        element: (
          <PlaceholderPage
            eyebrow="Bulunamadı"
            title="Bu sayfa bulunamadı"
            purpose="Adres demo kapsamındaki ekranlardan biriyle eşleşmiyor."
            questions={["Adres doğru yazıldı mı?"]}
            actions={["Operasyon genel bakışa dön"]}
            relatedTo={{ label: "Genel bakışa dön", to: "/operations" }}
          />
        ),
      },
    ],
  },
]);
