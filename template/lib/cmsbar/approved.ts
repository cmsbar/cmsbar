import { cmsConfig } from "@/cms.config";

export function approvedLabelName(): string {
  return (
    process.env.CMS_APPROVED_LABEL || cmsConfig.approvedLabel
  ).toLowerCase();
}

export function isApproved(labels: { name: string }[]): boolean {
  const target = approvedLabelName();
  return labels.some((l) => l.name.toLowerCase() === target);
}
