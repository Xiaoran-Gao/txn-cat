import type { ClassificationJob } from "../types";

export type ClassificationProgressSnapshot = {
  total: number;
  processed: number;
  categorized: number;
  failed: number;
  percent: number;
  isActive: boolean;
};

function toSafeCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function getClassificationProgress(job: ClassificationJob): ClassificationProgressSnapshot {
  const total = toSafeCount(job.total);
  const categorized = Math.min(toSafeCount(job.categorized), total || toSafeCount(job.categorized));
  const remainingAfterCategorized = Math.max(0, total - categorized);
  const failed = Math.min(toSafeCount(job.failed), total ? remainingAfterCategorized : toSafeCount(job.failed));
  const reportedProcessed = toSafeCount(job.processed);
  const countedProcessed = categorized + failed;
  const processed = total
    ? Math.min(total, Math.max(reportedProcessed, countedProcessed))
    : Math.max(reportedProcessed, countedProcessed);
  const percent = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return {
    total,
    processed,
    categorized,
    failed,
    percent,
    isActive: job.status === "running" && total > 0 && processed < total,
  };
}
