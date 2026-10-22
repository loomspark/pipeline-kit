import { appendFileSync } from "node:fs";
import { TIER_NAMES } from "./types.ts";
import type { Finding } from "./hard-rules.ts";
import type { Approval, RiskResult } from "./risk.ts";
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

export function riskSummary(result: RiskResult, approval: Approval, config: PipelineConfig): string {
  const { label, fromTier } = config.risk.approval;
  const verdict: Record<Approval, string> = {
    "not-needed": `Below tier ${fromTier}: no approval needed.`,
    approved: `Approved: \`${label}\` was applied to this head.`,
    needed: `Needs approval: an approver reviews the change and applies the \`${label}\` label.`,
    stale: `Approval is stale: the change or its labels moved after \`${label}\` was applied. An approver re-checks and removes then re-applies the label.`,
  };
  const rows = [...result.files]
    .sort((a, b) => b.tier - a.tier || a.path.localeCompare(b.path))
    .map((f) => {
      const why = f.rules.length ? f.rules.map((r) => md(r.reason) + (r.ref ? ` (${md(r.ref)})` : "")).join("; ") : "default tier";
      return `| ${f.tier} | \`${md(f.path)}\` | ${why} |`;
    });
  return [
    `### Risk: tier ${result.tier} (${TIER_NAMES[result.tier]})`,
    "",
    verdict[approval] + (config.risk.enforce ? "" : " (report only: `risk.enforce` is false)"),
    "",
    "| Tier | File | Why |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");
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
