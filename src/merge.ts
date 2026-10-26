// Guarded merge (ADR 0003): the only way agents merge. It merges a PR as the agent identity
// only when GitHub's own records say it's safe:
//   - the PR is open, not a draft, and has no conflicts
//   - every check run on the head commit has finished and none failed
//   - every commit status on the head is success, and that includes `pipeline-kit/risk`
//     (green means low risk, or a listed approver approved this exact commit)
//   - the head hasn't moved: GitHub refuses the merge if it changed since we looked
// Anything else is refused with the reasons, so the rule that lets agents run this
// command can't be used to merge something risky or broken.

import type { GitHub } from "./github.ts";

export const RISK_STATUS_CONTEXT = "pipeline-kit/risk";

export interface PullInfo {
  number: number;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  headSha: string;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string; // queued | in_progress | completed ...
  conclusion: string | null; // success | failure | neutral | skipped | cancelled | timed_out | action_required | stale
}

export interface CommitStatus {
  context: string;
  state: string; // success | failure | error | pending
  description?: string;
}

export interface MergeDecision {
  ok: boolean;
  reasons: string[];
  passed: string[];
}

const PASSING = new Set(["success", "neutral", "skipped"]);

/** Pure decision from GitHub's records; exported for tests. */
export function mergeDecision(pr: PullInfo, runs: readonly CheckRun[], statuses: readonly CommitStatus[]): MergeDecision {
  const reasons: string[] = [];
  const passed: string[] = [];

  if (pr.merged) reasons.push("already merged");
  else if (pr.state !== "open") reasons.push(`PR is ${pr.state}`);
  if (pr.draft) reasons.push("PR is a draft");
  if (pr.mergeable === false) reasons.push("PR has merge conflicts");
  if (pr.mergeable === null) reasons.push("GitHub hasn't worked out whether it can merge yet; try again shortly");

  // A check can run several times on one commit (pushes, label changes, reviews). Judge
  // each by its latest run that actually ran: a later "skipped" never hides an earlier failure.
  const byName = new Map<string, CheckRun[]>();
  for (const r of runs) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  if (byName.size === 0) reasons.push("no checks have run on this commit yet");
  for (const [name, all] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...all].sort((a, b) => a.id - b.id);
    if (sorted.some((r) => r.status !== "completed")) {
      reasons.push(`check "${name}" is still running`);
      continue;
    }
    const ran = sorted.filter((r) => r.conclusion !== "skipped");
    const latest = ran.at(-1) ?? sorted.at(-1)!;
    if (PASSING.has(latest.conclusion ?? "")) passed.push(`check "${name}": ${latest.conclusion}`);
    else reasons.push(`check "${name}" ${latest.conclusion ?? "has no result"}`);
  }

  const risk = statuses.find((s) => s.context === RISK_STATUS_CONTEXT);
  if (!risk) reasons.push(`no ${RISK_STATUS_CONTEXT} status on this commit (is the project on pipeline-kit v1?)`);
  for (const s of statuses) {
    const label = `status "${s.context}"${s.description ? ` (${s.description})` : ""}`;
    if (s.state === "success") passed.push(`${label}: success`);
    else reasons.push(`${label} is ${s.state}`);
  }

  return { ok: reasons.length === 0, reasons, passed };
}

async function pull(gh: GitHub, number: number): Promise<PullInfo> {
  // GitHub computes mergeability in the background; ask a few times.
  for (let attempt = 0; ; attempt++) {
    const p = await gh.request<{ number: number; state: string; draft: boolean; merged: boolean; mergeable: boolean | null; head: { sha: string } }>(
      "GET",
      `/repos/${gh.repo}/pulls/${number}`,
    );
    if (p.mergeable !== null || attempt >= 4) {
      return { number: p.number, state: p.state, draft: p.draft, merged: p.merged, mergeable: p.mergeable, headSha: p.head.sha };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function checkRuns(gh: GitHub, sha: string): Promise<CheckRun[]> {
  const out: CheckRun[] = [];
  for (let page = 1; ; page++) {
    const r = await gh.request<{ check_runs: CheckRun[] }>("GET", `/repos/${gh.repo}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    out.push(...r.check_runs.map(({ id, name, status, conclusion }) => ({ id, name, status, conclusion })));
    if (r.check_runs.length < 100) return out;
  }
}

async function statuses(gh: GitHub, sha: string): Promise<CommitStatus[]> {
  // The combined status holds the latest status per context.
  const r = await gh.request<{ statuses: CommitStatus[] }>("GET", `/repos/${gh.repo}/commits/${sha}/status?per_page=100`);
  return r.statuses.map(({ context, state, description }) => ({ context, state, description }));
}

export interface MergeResult {
  merged: boolean;
  decision: MergeDecision;
  sha?: string;
  message: string;
}

/** Check, then merge pinned to the head that was checked. `gh` must act as the agent. */
export async function guardedMerge(gh: GitHub, number: number): Promise<MergeResult> {
  const pr = await pull(gh, number);
  const decision = mergeDecision(pr, await checkRuns(gh, pr.headSha), await statuses(gh, pr.headSha));
  if (!decision.ok) return { merged: false, decision, message: `Not merged: ${decision.reasons.join("; ")}.` };
  try {
    const r = await gh.request<{ sha: string }>("PUT", `/repos/${gh.repo}/pulls/${number}/merge`, {
      merge_method: "merge",
      sha: pr.headSha, // GitHub refuses (409) if the head moved after our checks
    });
    return { merged: true, decision, sha: r.sha, message: `Merged #${number} as the agent (${r.sha.slice(0, 7)}).` };
  } catch (e) {
    const status = (e as { status?: number }).status;
    const why =
      status === 409 ? "the PR changed after the checks were read; run it again"
      : status === 405 ? "GitHub won't merge it (for example it changes .github/workflows, which the agent can't touch: the owner merges those)"
      : (e as Error).message;
    return { merged: false, decision, message: `Not merged: ${why}.` };
  }
}
