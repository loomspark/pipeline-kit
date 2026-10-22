import { matchesAny } from "./glob.ts";
import type { ChangedFile } from "./diff.ts";
import type { PipelineConfig, RiskRule, Tier } from "./types.ts";

// Changed-path risk classification (design: "AI judges intent, rules check reality").
// A file takes the highest tier of the rules matching it, or the default when none do;
// the change takes the highest tier of its files. Deleted files count: removing a
// migration or an auth module is as risky as editing it.

export interface FileRisk {
  path: string;
  tier: Tier;
  rules: RiskRule[];
}

export interface RiskResult {
  tier: Tier;
  files: FileRisk[];
}

export function classify(files: readonly ChangedFile[], config: PipelineConfig): RiskResult {
  const out: FileRisk[] = files.map(({ path }) => {
    const rules = config.risk.rules.filter((r) => matchesAny(path, r.paths));
    const tier = rules.length ? (Math.max(...rules.map((r) => r.tier)) as Tier) : config.risk.defaultTier;
    return { path, tier, rules: rules.filter((r) => r.tier === tier) };
  });
  const tier = out.length ? (Math.max(...out.map((f) => f.tier)) as Tier) : 0;
  return { tier, files: out };
}

export interface ApprovalEvent {
  /** pull_request event action, e.g. "opened", "synchronize", "labeled". */
  action: string;
  /** For "labeled"/"unlabeled": the label that changed. */
  label?: string;
  /** Labels on the PR at the time of the event. */
  labels: readonly string[];
}

export type Approval = "not-needed" | "approved" | "needed" | "stale";

/**
 * Approval counts only on the event that applies the approval label, so it always
 * refers to the head that was there when the approver acted. Any later event (a new
 * push, another label change) reruns the check and needs the label re-applied.
 * Fails closed; see docs/adr/0001 and open question K3 for the identity gap.
 */
export function approvalState(tier: Tier, config: PipelineConfig, event: ApprovalEvent): Approval {
  const { label, fromTier } = config.risk.approval;
  if (tier < fromTier) return "not-needed";
  if (event.action === "labeled" && event.label === label) return "approved";
  return event.labels.includes(label) ? "stale" : "needed";
}
