import type { IssuePriority, Prisma } from "@prisma/client";
import type {
  CoverageRow,
  DataQualityResponse,
  QualityIssue,
  SourceHealthRow,
} from "@gbsoft/domain";
import { graphCoverage } from "@gbsoft/domain";
import { loadStoredGraph } from "../twin/graph.js";

type DbClient = Prisma.TransactionClient;

type IssueDraft = Omit<QualityIssue, "detectedAt"> & {
  priorityDb: IssuePriority;
};

const PRIORITY_LABEL: Record<IssuePriority, QualityIssue["priority"]> = {
  CRITICAL: "Kritik",
  HIGH: "Yüksek",
  MEDIUM: "Orta",
  LOW: "Düşük",
};

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1_000) / 10;
}

function affectedLabel(count: number, noun: string): string {
  return `${count} ${noun}`;
}

function weightedReadiness(rows: CoverageRow[]): number {
  const weights: Record<string, number> = {
    "sku-physical": 0.3,
    "location-capacity": 0.2,
    "event-completeness": 0.2,
    "graph-coverage": 0.2,
    identity: 0.1,
  };
  return (
    Math.round(
      rows.reduce((sum, row) => sum + row.valuePct * (weights[row.key] ?? 0), 0) * 10,
    ) / 10
  );
}

/**
 * Gerçek veritabanı snapshot'ından veri kalitesi metriklerini hesaplar,
 * açık sorunları idempotent olarak günceller ve yayın kapısını döndürür.
 */
export async function evaluateDataQuality(
  db: DbClient,
  tenantId: string,
  facilityId: string,
): Promise<DataQualityResponse> {
  const now = new Date();
  const facility = await db.facility.findFirst({
    where: { id: facilityId, tenantId },
    select: { id: true, code: true },
  });
  if (!facility) throw new Error("Veri kalitesi ölçülecek tesis bulunamadı.");

  const activeLayout = await db.layoutVersion.findFirst({
    where: { tenantId, facilityId, isActive: true },
    orderBy: { version: "desc" },
    select: { id: true, version: true, createdAt: true },
  });

  const [skus, locations, taskCount, completeTaskCount, identityCount, latestImports] =
    await Promise.all([
      db.sku.findMany({
        where: { tenantId, facilityId },
        orderBy: { code: "asc" },
        select: {
          code: true,
          sourceSystem: true,
          sourceId: true,
          dimension: {
            select: { widthCm: true, depthCm: true, heightCm: true, weightKg: true },
          },
        },
      }),
      activeLayout
        ? db.location.findMany({
            where: { tenantId, layoutVersionId: activeLayout.id },
            orderBy: { code: "asc" },
            select: {
              code: true,
              maxWeightKg: true,
              maxVolumeM3: true,
              dataQuality: true,
            },
          })
        : Promise.resolve([]),
      db.pickTask.count({ where: { tenantId, wave: { facilityId } } }),
      db.pickTask.count({
        where: {
          tenantId,
          wave: { facilityId },
          startedAt: { not: null },
          completedAt: { not: null },
          durationSec: { not: null },
        },
      }),
      db.identityMap.count({
        where: { tenantId, facilityId, entityType: "sku" },
      }),
      db.importBatch.findMany({
        where: { tenantId, facilityId, status: "APPLIED" },
        orderBy: { createdAt: "desc" },
        distinct: ["kind"],
        select: { kind: true, createdAt: true },
      }),
    ]);

  const completeSkuCodes = skus
    .filter((sku) => {
      const dimension = sku.dimension;
      return Boolean(
        dimension &&
          dimension.widthCm !== null &&
          dimension.depthCm !== null &&
          dimension.heightCm !== null &&
          dimension.weightKg !== null,
      );
    })
    .map((sku) => sku.code);
  const missingSkuCodes = skus
    .map((sku) => sku.code)
    .filter((code) => !completeSkuCodes.includes(code));

  const validCapacityCodes = locations
    .filter((location) => location.maxWeightKg > 0 && location.maxVolumeM3 > 0)
    .map((location) => location.code);
  const invalidCapacityCodes = locations
    .map((location) => location.code)
    .filter((code) => !validCapacityCodes.includes(code));
  const unverifiedCapacityCodes = locations
    .filter((location) => location.dataQuality < 1)
    .map((location) => location.code);

  let graphPct = 0;
  let graphLocationCount = 0;
  let mappedGraphLocations = 0;
  if (activeLayout) {
    const graphNodeCount = await db.graphNode.count({
      where: { tenantId, layoutVersionId: activeLayout.id },
    });
    if (graphNodeCount > 0) {
      const coverage = graphCoverage(
        await loadStoredGraph(db, tenantId, activeLayout.id),
      );
      graphPct = Math.min(
        coverage.coveragePct,
        pct(coverage.mappedLocationCount, locations.length),
      );
      graphLocationCount = locations.length;
      mappedGraphLocations = coverage.mappedLocationCount;
    }
  }

  const coverage: CoverageRow[] = [
    {
      key: "sku-physical",
      label: "SKU fiziksel veri",
      valuePct: pct(completeSkuCodes.length, skus.length),
      threshold: 98,
      context: `${skus.length} SKU · genişlik, derinlik, yükseklik, ağırlık`,
    },
    {
      key: "location-capacity",
      label: "Lokasyon kapasitesi",
      valuePct: pct(validCapacityCodes.length, locations.length),
      threshold: 98,
      context: `${locations.length} pick gözü · hacim ve ağırlık limiti`,
    },
    {
      key: "event-completeness",
      label: "Event completeness",
      valuePct: pct(completeTaskCount, taskCount),
      threshold: 95,
      context: `${taskCount} görev · başlangıç/bitiş/süre üçlüsü`,
    },
    {
      key: "graph-coverage",
      label: "Graph coverage",
      valuePct: graphPct,
      threshold: 100,
      context: `${mappedGraphLocations}/${Math.max(graphLocationCount, locations.length)} göz · blokajlar dahil`,
    },
    {
      key: "identity",
      label: "Kimlik eşleme",
      valuePct: pct(identityCount, skus.length),
      threshold: 99,
      context: `${identityCount}/${skus.length} SKU · kaynak ID ↔ kanonik kod`,
    },
  ];

  const issues: IssueDraft[] = [];
  if (missingSkuCodes.length > 0) {
    issues.push({
      id: "DQ-SKU-PHYSICAL",
      priority: "Kritik",
      priorityDb: "CRITICAL",
      problem: "SKU ölçüsü eksik",
      affectedLabel: affectedLabel(missingSkuCodes.length, "SKU"),
      affectedIds: missingSkuCodes,
      impact: "plan yayını blok",
      action: "Ölçüm görevi",
      owner: "Depo · master data",
      detail:
        "Kapasite kısıtı doğrulanamadığı için bu SKU'lar slot planına alınamaz ve plan yayını bloklanır.",
      blocksPublish: true,
    });
  }
  if (!activeLayout || graphPct < 100) {
    issues.push({
      id: "DQ-GRAPH-COVERAGE",
      priority: "Kritik",
      priorityDb: "CRITICAL",
      problem: "Depo grafı eksik veya bağlantısız",
      affectedLabel: activeLayout ? `${Math.max(0, locations.length - mappedGraphLocations)} göz` : "Aktif ikiz yok",
      affectedIds: [],
      impact: "rota ve plan yayını blok",
      action: "Grafı yeniden üret",
      owner: "Veri platformu",
      detail:
        "Her planlanabilir göz dock'a yürünebilir bir rota ile bağlı olmalıdır.",
      blocksPublish: true,
    });
  }
  if (invalidCapacityCodes.length > 0) {
    issues.push({
      id: "DQ-LOCATION-CAPACITY",
      priority: "Kritik",
      priorityDb: "CRITICAL",
      problem: "Lokasyon kapasitesi eksik",
      affectedLabel: affectedLabel(invalidCapacityCodes.length, "göz"),
      affectedIds: invalidCapacityCodes,
      impact: "hard constraint doğrulanamaz",
      action: "Kapasite ölçümü",
      owner: "Depo · layout",
      detail: "Ağırlık veya hacim kapasitesi sıfır olan gözler planlanamaz.",
      blocksPublish: true,
    });
  } else if (unverifiedCapacityCodes.length > 0) {
    issues.push({
      id: "DQ-LOCATION-UNVERIFIED",
      priority: "Yüksek",
      priorityDb: "HIGH",
      problem: "Lokasyon kapasitesi doğrulanmamış",
      affectedLabel: affectedLabel(unverifiedCapacityCodes.length, "göz"),
      affectedIds: unverifiedCapacityCodes,
      impact: "plan güveni düşer",
      action: "Saha doğrulaması",
      owner: "Depo · layout",
      detail: "Kapasite değeri mevcut ancak saha doğrulama puanı 1'in altında.",
      blocksPublish: false,
    });
  }
  if (taskCount === 0 || completeTaskCount < taskCount) {
    const incomplete = taskCount - completeTaskCount;
    issues.push({
      id: "DQ-EVENT-COMPLETENESS",
      priority: "Yüksek",
      priorityDb: "HIGH",
      problem: taskCount === 0 ? "Görev olayı yok" : "Görev olayı eksik",
      affectedLabel: taskCount === 0 ? "0 görev" : affectedLabel(incomplete, "görev"),
      affectedIds: [],
      impact: "model kalibrasyonu yapılamaz",
      action: "Olay akışını kontrol et",
      owner: "Veri platformu",
      detail: "Picking süre modelinin etiketi için başlangıç, bitiş ve süre birlikte gerekir.",
      blocksPublish: false,
    });
  }
  if (identityCount < skus.length) {
    const mappedCodes = new Set(
      (
        await db.identityMap.findMany({
          where: { tenantId, facilityId, entityType: "sku" },
          select: { canonicalCode: true },
        })
      ).map((row) => row.canonicalCode),
    );
    const missingIdentities = skus
      .map((sku) => sku.code)
      .filter((code) => !mappedCodes.has(code));
    issues.push({
      id: "DQ-IDENTITY",
      priority: "Orta",
      priorityDb: "MEDIUM",
      problem: "Kaynak kimlik eşlemesi eksik",
      affectedLabel: affectedLabel(missingIdentities.length, "SKU"),
      affectedIds: missingIdentities,
      impact: "write-back eşleşmesi belirsiz",
      action: "Kimlikleri eşle",
      owner: "Master data",
      detail: "Kanonik SKU kodunun kaynak sistem kimliğiyle birebir eşleşmesi gerekir.",
      blocksPublish: false,
    });
  }

  const activeCodes = issues.map((issue) => issue.id);
  await db.dataQualityIssue.updateMany({
    where: {
      tenantId,
      facilityId,
      resolvedAt: null,
      ...(activeCodes.length > 0 ? { code: { notIn: activeCodes } } : {}),
    },
    data: { resolvedAt: now },
  });
  for (const issue of issues) {
    await db.dataQualityIssue.upsert({
      where: { tenantId_facilityId_code: { tenantId, facilityId, code: issue.id } },
      update: {
        priority: issue.priorityDb,
        problem: issue.problem,
        detail: issue.detail,
        impact: issue.impact,
        suggestedAction: issue.action,
        owner: issue.owner,
        affectedIds: issue.affectedIds,
        affectedLabel: issue.affectedLabel,
        blocksPublish: issue.blocksPublish,
        resolvedAt: null,
      },
      create: {
        tenantId,
        facilityId,
        code: issue.id,
        priority: issue.priorityDb,
        problem: issue.problem,
        detail: issue.detail,
        impact: issue.impact,
        suggestedAction: issue.action,
        owner: issue.owner,
        affectedIds: issue.affectedIds,
        affectedLabel: issue.affectedLabel,
        blocksPublish: issue.blocksPublish,
        detectedAt: now,
      },
    });
  }

  const storedIssues = await db.dataQualityIssue.findMany({
    where: { tenantId, facilityId, resolvedAt: null },
    orderBy: [{ priority: "asc" }, { detectedAt: "asc" }],
  });
  const responseIssues: QualityIssue[] = storedIssues.map((issue) => ({
    id: issue.code,
    priority: PRIORITY_LABEL[issue.priority],
    problem: issue.problem,
    affectedLabel: issue.affectedLabel,
    affectedIds: issue.affectedIds,
    impact: issue.impact,
    action: issue.suggestedAction,
    owner: issue.owner,
    detail: issue.detail,
    blocksPublish: issue.blocksPublish,
    detectedAt: issue.detectedAt.toISOString(),
  }));
  const blockingIssueCodes = responseIssues
    .filter((issue) => issue.blocksPublish)
    .map((issue) => issue.id);

  const importByKind = new Map(latestImports.map((row) => [row.kind, row.createdAt]));
  const sourceHealth: SourceHealthRow[] = [
    {
      source: "WMS · Görev olayları",
      mode: "CSV / olay ingest",
      lastSync: importByKind.get("pick-task")?.toISOString() ?? "Henüz veri yok",
      completenessPct: pct(completeTaskCount, taskCount),
      state: taskCount > 0 && completeTaskCount === taskCount ? "sağlıklı" : "uyarı",
    },
    {
      source: "Master data · SKU ölçü",
      mode: "CSV / API",
      lastSync: importByKind.get("sku")?.toISOString() ?? "Henüz veri yok",
      completenessPct: pct(completeSkuCodes.length, skus.length),
      state: missingSkuCodes.length === 0 ? "sağlıklı" : "uyarı",
    },
    {
      source: "Twin · Layout ve graph",
      mode: "Sürümlü dijital ikiz",
      lastSync: activeLayout?.createdAt.toISOString() ?? "Aktif ikiz yok",
      completenessPct: graphPct,
      state: graphPct === 100 ? "sağlıklı" : "kritik",
    },
  ];

  return {
    facilityCode: facility.code,
    readinessPct: weightedReadiness(coverage),
    coverage,
    issues: responseIssues,
    sourceHealth,
    publishGate: {
      allowed: blockingIssueCodes.length === 0,
      blockingIssueCodes,
      reason:
        blockingIssueCodes.length > 0
          ? `${blockingIssueCodes.length} kritik veri kalitesi sorunu plan yayınını blokluyor.`
          : undefined,
    },
    blockingIssueCount: blockingIssueCodes.length,
    lastValidatedAt: now.toISOString(),
  };
}
