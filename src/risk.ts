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
  /** pull_request / pull_request_review event action, e.g. "opened", "synchronize", "labeled", "submitted". */
  action: string;
  /** For "labeled"/"unlabeled": the label that changed. */
  label?: string;
  /** Login of whoever caused the event (GitHub's `sender`). */
  actor?: string;
  /** Labels on the PR at the time of the event. */
  labels: readonly string[];
}

export interface Review {
  user: string;
  /** APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED or PENDING. */
  state: string;
  /** The commit the review was made against. */
  commit: string;
  url?: string;
}

export type ApprovalStatus = "not-needed" | "approved" | "needed" | "stale";

export interface Approval {
  status: ApprovalStatus;
  /** Who approved, when approved. Comes from GitHub's record, never from an agent. */
  by?: string;
  /** For review approvals: the review's URL. */
  evidence?: string;
}

const normalise = (login: string) => login.toLowerCase();

/**
 * method "review" (traceable): approved when an approver's latest decisive review
 * (approve, request changes or dismissed) approves the PR's current head commit. GitHub
 * records who reviewed and against which commit, so a later push makes it stale.
 *
 * method "label": approval counts only on the event that applies the label (so it refers
 * to the head the approver saw), and, when approvers are listed, only if one of them
 * applied it. Any later event needs it re-applied. Fails closed.
 */
export function approvalState(
  tier: Tier,
  config: PipelineConfig,
  event: ApprovalEvent,
  review?: { head: string; reviews: readonly Review[] },
): Approval {
  const { method, label, fromTier } = config.risk.approval;
  if (tier < fromTier) return { status: "not-needed" };
  const approvers = config.risk.approval.approvers.map(normalise);
  const isApprover = (login?: string) => !!login && (approvers.length === 0 || approvers.includes(normalise(login)));

  if (method === "review") {
    if (!review) return { status: "needed" };
    let stale = false;
    for (const approver of approvers) {
      const decisive = review.reviews.filter((r) => normalise(r.user) === approver && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state));
      const latest = decisive.at(-1);
      if (latest?.state !== "APPROVED") continue;
      if (latest.commit === review.head) return { status: "approved", by: latest.user, evidence: latest.url };
      stale = true;
    }
    return { status: stale ? "stale" : "needed" };
  }

  if (event.action === "labeled" && event.label === label && isApprover(event.actor)) {
    return { status: "approved", by: event.actor };
  }
  return { status: event.labels.includes(label) ? "stale" : "needed" };
}
