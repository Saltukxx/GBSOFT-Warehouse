import { describe, expect, it } from "vitest";
import { FACILITY } from "@gbsoft/seed";
import { LOCATIONS } from "@gbsoft/seed";
import { SKUS } from "@gbsoft/seed";
import {
  DEMO_SLOT_PLAN,
  LOCKED_REOPTIMIZED_PLAN,
  RECOMMENDATIONS,
} from "@gbsoft/seed";
import {
  DROPPED_TASK_SEQS_R1,
  MOVE_TASKS,
  MOVE_TASKS_R1,
} from "@gbsoft/seed";
import { PLAN_BREAKDOWN } from "@gbsoft/seed";

/**
 * Demo verisi tutarlılık testleri (§22.3, §23).
 * Sayılar ekranlar arasında farklı görünemez.
 */

const round = (value: number, decimals = 1) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

describe("tesis ve yerleşim", () => {
  it("96 pick lokasyonu üretir", () => {
    expect(LOCATIONS).toHaveLength(FACILITY.locationCount);
  });

  it("12 koridor ve 4 zon içerir", () => {
    expect(new Set(LOCATIONS.map((l) => l.aisle)).size).toBe(
      FACILITY.aisleCount,
    );
    expect(new Set(LOCATIONS.map((l) => l.zone)).size).toBe(
      FACILITY.zoneCount,
    );
  });

  it("lokasyon kimlikleri benzersizdir", () => {
    expect(new Set(LOCATIONS.map((l) => l.id)).size).toBe(LOCATIONS.length);
  });

  it("184 SKU üretir ve kimlikler benzersizdir", () => {
    expect(SKUS).toHaveLength(FACILITY.skuCount);
    expect(new Set(SKUS.map((s) => s.id)).size).toBe(SKUS.length);
  });

  it("senaryodaki SKU'lar şartnamedeki lokasyonlarda durur", () => {
    const expected: Record<string, string> = {
      "SKU-184": "B-11-04",
      "SKU-074": "A-03-02",
      "SKU-221": "C-08-03",
      "SKU-019": "B-09-01",
      "SKU-307": "A-04-02",
      "SKU-142": "D-12-01",
    };
    for (const [skuId, locationId] of Object.entries(expected)) {
      expect(SKUS.find((s) => s.id === skuId)?.currentLocationId).toBe(
        locationId,
      );
    }
  });

  it("bir pick gözünde en fazla bir SKU bulunur", () => {
    const slotted = SKUS.filter((s) => s.currentLocationId !== "REZERV");
    expect(new Set(slotted.map((s) => s.currentLocationId)).size).toBe(
      slotted.length,
    );
  });

  it("lokasyon süre ortalaması tesis P50'si ile tutarlıdır", () => {
    const mean =
      LOCATIONS.reduce((sum, l) => sum + l.pickTimeSec, 0) / LOCATIONS.length;
    expect(Math.abs(mean - PLAN_BREAKDOWN.p50Sec)).toBeLessThan(2.5);
  });
});

describe("picking time bileşenleri", () => {
  it("bileşen toplamı P50'ye eşittir", () => {
    const sum =
      PLAN_BREAKDOWN.queueSec +
      PLAN_BREAKDOWN.travelSec +
      PLAN_BREAKDOWN.searchSec +
      PLAN_BREAKDOWN.reachScanSec +
      PLAN_BREAKDOWN.handleSec +
      PLAN_BREAKDOWN.congestionSec +
      PLAN_BREAKDOWN.exceptionSec;
    expect(round(sum)).toBe(PLAN_BREAKDOWN.p50Sec);
  });
});

describe("slot planı SP-2026-081", () => {
  it("şartnamedeki özet değerleri taşır", () => {
    expect(DEMO_SLOT_PLAN.netOperationDeltaPct).toBe(-7.6);
    expect(DEMO_SLOT_PLAN.pickingTimeDeltaPct).toBe(-9.8);
    expect(DEMO_SLOT_PLAN.walkingDeltaPct).toBe(-12.4);
    expect(DEMO_SLOT_PLAN.replenishmentDeltaPct).toBe(3.1);
    expect(DEMO_SLOT_PLAN.moveTaskCount).toBe(26);
    expect(DEMO_SLOT_PLAN.moveHours).toBe(4.3);
    expect(DEMO_SLOT_PLAN.affectedSkuCount).toBe(21);
    expect(DEMO_SLOT_PLAN.hardViolationCount).toBe(0);
  });

  it("21 öneri içerir ve her SKU bir kez geçer", () => {
    expect(RECOMMENDATIONS).toHaveLength(DEMO_SLOT_PLAN.affectedSkuCount);
    expect(new Set(RECOMMENDATIONS.map((r) => r.skuId)).size).toBe(
      RECOMMENDATIONS.length,
    );
  });

  it("hedef lokasyonlar çakışmaz", () => {
    const targets = RECOMMENDATIONS.map((r) => r.targetLocationId);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("kaynak ve hedefler gerçek lokasyonlardır", () => {
    const ids = new Set(LOCATIONS.map((l) => l.id));
    for (const rec of RECOMMENDATIONS) {
      expect(ids.has(rec.sourceLocationId)).toBe(true);
      expect(ids.has(rec.targetLocationId)).toBe(true);
      expect(rec.sourceLocationId).not.toBe(rec.targetLocationId);
    }
  });

  it("SKU-184 önerisi şartnameyle birebir aynıdır", () => {
    const rec = RECOMMENDATIONS.find((r) => r.skuId === "SKU-184");
    expect(rec?.sourceLocationId).toBe("B-11-04");
    expect(rec?.targetLocationId).toBe("A-03-02");
    expect(rec?.expectedSecondsPerLineDelta).toBe(-11.4);
    expect(rec?.replenishmentDeltaPerDay).toBe(2);
  });

  it("bloklu gözler hedef olarak seçilmez", () => {
    const blocked = new Set(
      LOCATIONS.filter((l) => l.blocked).map((l) => l.id),
    );
    for (const rec of RECOMMENDATIONS) {
      expect(blocked.has(rec.targetLocationId)).toBe(false);
    }
  });
});

describe("taşıma görevleri", () => {
  it("26 görev üretir ve sıra numaraları benzersizdir", () => {
    expect(MOVE_TASKS).toHaveLength(DEMO_SLOT_PLAN.moveTaskCount);
    expect(new Set(MOVE_TASKS.map((t) => t.seq)).size).toBe(MOVE_TASKS.length);
  });

  it("her öneri için bir taşıma görevi vardır", () => {
    const moved = MOVE_TASKS.filter((t) => t.skuId).map((t) => t.skuId);
    expect(new Set(moved).size).toBe(RECOMMENDATIONS.length);
  });

  it("yük toplamı plan özetiyle eşleşir", () => {
    const total = MOVE_TASKS.reduce((sum, t) => sum + t.loadHours, 0);
    expect(round(total)).toBe(DEMO_SLOT_PLAN.moveHours);
  });

  it("fayda toplamı net etkiyle eşleşir", () => {
    const total = MOVE_TASKS.reduce((sum, t) => sum + t.expectedBenefitPct, 0);
    expect(round(total)).toBe(DEMO_SLOT_PLAN.netOperationDeltaPct);
  });

  it("Zone A kısmi onayı 11 görev, 2 paket, 1,7 sa ve -4,1% verir", () => {
    const zoneA = MOVE_TASKS.filter((t) => t.zone === "A");
    expect(zoneA).toHaveLength(11);
    expect(new Set(zoneA.map((t) => t.packageId)).size).toBe(2);
    expect(round(zoneA.reduce((s, t) => s + t.loadHours, 0))).toBe(1.7);
    expect(round(zoneA.reduce((s, t) => s + t.expectedBenefitPct, 0))).toBe(
      -4.1,
    );
  });

  it("Zone A paketleri bütün Zone A lokasyon değişikliklerini kapsar", () => {
    const zoneATaskSkus = new Set(
      MOVE_TASKS.filter((t) => t.zone === "A" && t.skuId).map((t) => t.skuId),
    );
    const touchingZoneA = RECOMMENDATIONS.filter(
      (r) =>
        r.sourceLocationId.startsWith("A-") ||
        r.targetLocationId.startsWith("A-"),
    );
    for (const rec of touchingZoneA) {
      expect(zoneATaskSkus.has(rec.skuId)).toBe(true);
    }
  });

  it("önkoşullar kendinden önceki görevlere işaret eder", () => {
    const bySeq = new Map(MOVE_TASKS.map((t) => [t.seq, t]));
    for (const task of MOVE_TASKS) {
      for (const dep of task.dependsOn) {
        expect(bySeq.has(dep)).toBe(true);
        expect(dep).toBeLessThan(task.seq);
      }
    }
  });

  it("bir gözü boşaltan görev, o göze taşıyan görevden önce gelir", () => {
    const bySku = new Map(RECOMMENDATIONS.map((r) => [r.skuId, r]));
    const vacateSeqByLocation = new Map<string, number>();
    for (const task of MOVE_TASKS) {
      if (!task.skuId) continue;
      const rec = bySku.get(task.skuId);
      if (rec) vacateSeqByLocation.set(rec.sourceLocationId, task.seq);
    }
    for (const task of MOVE_TASKS) {
      if (!task.skuId) continue;
      const rec = bySku.get(task.skuId);
      if (!rec) continue;
      const blocker = vacateSeqByLocation.get(rec.targetLocationId);
      if (blocker === undefined || blocker === task.seq) continue;
      expect(task.dependsOn).toContain(blocker);
    }
  });
});

describe("kilitli yeniden optimizasyon SP-2026-081-R1", () => {
  it("şartnamedeki özet değerleri taşır", () => {
    expect(LOCKED_REOPTIMIZED_PLAN.id).toBe("SP-2026-081-R1");
    expect(LOCKED_REOPTIMIZED_PLAN.netOperationDeltaPct).toBe(-7.2);
    expect(LOCKED_REOPTIMIZED_PLAN.pickingTimeDeltaPct).toBe(-9.4);
    expect(LOCKED_REOPTIMIZED_PLAN.walkingDeltaPct).toBe(-11.9);
    expect(LOCKED_REOPTIMIZED_PLAN.replenishmentDeltaPct).toBe(2.8);
    expect(LOCKED_REOPTIMIZED_PLAN.moveTaskCount).toBe(24);
    expect(LOCKED_REOPTIMIZED_PLAN.moveHours).toBe(3.9);
    expect(LOCKED_REOPTIMIZED_PLAN.hardViolationCount).toBe(0);
  });

  it("24 görev bırakır ve yük/fayda toplamları planla eşleşir", () => {
    expect(MOVE_TASKS_R1).toHaveLength(
      LOCKED_REOPTIMIZED_PLAN.moveTaskCount,
    );
    expect(round(MOVE_TASKS_R1.reduce((s, t) => s + t.loadHours, 0))).toBe(
      LOCKED_REOPTIMIZED_PLAN.moveHours,
    );
    expect(
      round(MOVE_TASKS_R1.reduce((s, t) => s + t.expectedBenefitPct, 0)),
    ).toBe(LOCKED_REOPTIMIZED_PLAN.netOperationDeltaPct);
  });

  it("Zone A görev sayısı 11 kalır", () => {
    expect(MOVE_TASKS_R1.filter((t) => t.zone === "A")).toHaveLength(11);
  });

  it("düşen görevler başka görevlerin önkoşulu değildir", () => {
    const dropped = new Set(DROPPED_TASK_SEQS_R1);
    for (const task of MOVE_TASKS_R1) {
      for (const dep of task.dependsOn) {
        expect(dropped.has(dep)).toBe(false);
      }
    }
  });
});
