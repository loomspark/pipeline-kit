import { appendFileSync } from "node:fs";
import { TIER_NAMES } from "./types.ts";
import type { Finding } from "./hard-rules.ts";
import type { Approval, RiskResult } from "./risk.ts";
import type { Tier } from "./types.ts";
import type { PipelineConfig } from "./types.ts";

// Output for people (job summary, terminal) and for GitHub (annotations, step outputs).
// Paths, rule ids and descriptions only; never file content.

export function annotation(level: "error" | "warning" | "notice", message: string, props: Record<string, string | number | undefined> = {}): string {
  const p = Object.entries(props)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${escapeProperty(String(v))}`)
    .join(",");
  return `::${level}${p ? " " + p : ""}::${escapeData(message)}`;
}

function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

const md = (s: string) => s.replace(/\|/g, "\\|").replace(/`/g, "'");

export function hardRulesSummary(findings: readonly Finding[], filesChecked: number): string {
  if (!findings.length) return `### Hard rules: passed\n\n${filesChecked} changed file(s) checked.\n`;
  const rows = findings.map((f) => `| \`${md(f.rule.id)}\` | \`${md(f.path)}\` | ${f.line ?? "whole file"} | ${md(f.rule.description)}${f.rule.ref ? ` (${md(f.rule.ref)})` : ""} |`);
  return [
    `### Hard rules: ${findings.length} finding(s)`,
    "",
    "Matched text is never shown. Open the file at the line to see it. Exemptions go in the project config, which is itself a risky path.",
    "",
    "| Rule | File | Line | Why |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function approvalLine(approval: Approval, config: PipelineConfig): string {
  const { method, label, fromTier, approvers } = config.risk.approval;
  const who = approvers.length ? approvers.map((a) => `@${a}`).join(" or ") : "an approver";
  const how = method === "review" ? "approves this pull request (a GitHub review)" : `applies the \`${label}\` label`;
  switch (approval.status) {
    case "not-needed":
      return `Below tier ${fromTier}: no approval needed.`;
    case "approved":
      return `Approved by @${approval.by}${approval.evidence ? ` ([review](${approval.evidence}))` : ""}, for this exact version.`;
    case "needed":
      return `Waiting for approval: ${who} ${how}.`;
    case "stale":
      return method === "review"
        ? `The approval was for an earlier version. ${who} approves again to cover the latest changes.`
        : `Approval is stale: the change or its labels moved after \`${label}\` was applied. ${who} removes and re-applies the label.`;
  }
}

function fileRows(result: RiskResult): string[] {
  return [...result.files]
    .sort((a, b) => b.tier - a.tier || a.path.localeCompare(b.path))
    .map((f) => {
      const why = f.rules.length ? f.rules.map((r) => md(r.reason) + (r.ref ? ` (${md(r.ref)})` : "")).join("; ") : "default tier";
      return `| ${f.tier} | \`${md(f.path)}\` | ${why} |`;
    });
}

export function riskSummary(result: RiskResult, approval: Approval, config: PipelineConfig): string {
  return [
    `### Risk: tier ${result.tier} (${TIER_NAMES[result.tier]})`,
    "",
    approvalLine(approval, config) + (config.risk.enforce ? "" : " (report only: `risk.enforce` is false)"),
    "",
    "| Tier | File | Why |",
    "|---|---|---|",
    ...fileRows(result),
    "",
  ].join("\n");
}

export const RISK_COMMENT_MARKER = "<!-- pipeline-kit:risk -->";

/** The PR comment an approver reads, often on a phone: plain English first, detail folded. */
export function riskComment(result: RiskResult, approval: Approval, config: PipelineConfig): string {
  const risky = result.files.filter((f) => f.tier >= config.risk.approval.fromTier);
  const reasons = [...new Set(risky.flatMap((f) => f.rules.map((r) => r.reason)))];
  const icon = approval.status === "approved" ? "✅" : approval.status === "not-needed" ? "ℹ️" : "⏳";
  const lines = [
    `### ${icon} Risk check: tier ${result.tier} (${TIER_NAMES[result.tier]})`,
    "",
    approvalLine(approval, config),
    "",
  ];
  if (risky.length) {
    lines.push("**Why it needs approval:** it changes " + reasons.map((r) => r.charAt(0).toLowerCase() + r.slice(1)).join("; ") + ".", "");
  }
  if (approval.status === "needed" || approval.status === "stale") {
    lines.push(
      "**Before approving:** read the agent's plain-English summary in the description above, and the files below.",
      config.risk.approval.method === "review"
        ? "**To approve:** Files changed → Review changes → Approve (or Approve in the GitHub mobile app). It covers this exact version; any later commit needs approving again."
        : `**To approve:** add the \`${config.risk.approval.label}\` label.`,
      "",
    );
  }
  lines.push("<details><summary>Every changed file and its tier</summary>", "", "| Tier | File | Why |", "|---|---|---|", ...fileRows(result), "", "</details>", "");
  return lines.join("\n");
}

/** Commit status description, at most 140 characters. */
export function riskStatusDescription(tier: Tier, approval: Approval, config: PipelineConfig): string {
  const head = `Tier ${tier} (${TIER_NAMES[tier]})`;
  const approvers = config.risk.approval.approvers.map((a) => `@${a}`).join(" or ") || "an approver";
  switch (approval.status) {
    case "not-needed":
      return `${head}: no approval needed`;
    case "approved":
      return `${head}: approved by @${approval.by}`;
    case "needed":
      return `${head}: waiting for ${approvers}`;
    case "stale":
      return `${head}: new changes since approval; waiting for ${approvers}`;
  }
}

export function writeSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, markdown + "\n");
}

export function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    const delimiter = `kit_${Math.random().toString(36).slice(2)}`;
    appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
}
