/** Veri kalitesi ve plan yayın kapısı sözleşmeleri. */

export type CoverageRow = {
  key: string;
  label: string;
  valuePct: number;
  threshold: number;
  context: string;
};

export type QualityIssue = {
  id: string;
  priority: "Kritik" | "Yüksek" | "Orta" | "Düşük";
  problem: string;
  affectedLabel: string;
  affectedIds: string[];
  impact: string;
  action: string;
  owner: string;
  detail: string;
  blocksPublish: boolean;
  detectedAt: string;
};

export type SourceHealthRow = {
  source: string;
  mode: string;
  lastSync: string;
  completenessPct: number;
  state: "sağlıklı" | "uyarı" | "kritik";
};

export type PublishGate = {
  allowed: boolean;
  blockingIssueCodes: string[];
  reason?: string;
};

export type DataQualityResponse = {
  facilityCode: string;
  readinessPct: number;
  coverage: CoverageRow[];
  issues: QualityIssue[];
  sourceHealth: SourceHealthRow[];
  publishGate: PublishGate;
  blockingIssueCount: number;
  lastValidatedAt: string;
};
