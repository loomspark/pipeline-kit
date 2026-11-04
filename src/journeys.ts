// Key journeys against a preview (milestone 3). The project holds its Playwright specs and
// lists them under `journeys`; the kit finds the preview, hands the specs only the secrets
// the config grants the `journeys` stage, and runs them. A failing or missing journey fails
// the job, which is a check, so `agent merge` refuses until it passes.
//
// Contract with the project's Playwright config (docs/design.md#journeys):
//   PIPELINE_PREVIEW_URL      the preview's base URL
//   PIPELINE_PREVIEW_HEADERS  JSON object of HTTP headers to send to that origin only
//                             (e.g. a host's protection-bypass header). Values are secrets:
//                             never log them, and keep traces, videos and HAR files off.
// Each secret named under `secrets.journeys` is also set as an environment variable.

import { spawnSync } from "node:child_process";
import type { PipelineConfig } from "./types.ts";

export const JOURNEYS_STAGE = "journeys";

export class JourneyError extends Error {}

/** Spec files to run, in config order. Fails closed if a listed journey has no spec. */
export function journeySpecs(config: PipelineConfig): string[] {
  const journeys = config.journeys ?? [];
  const missing = journeys.filter((j) => !j.spec).map((j) => j.id);
  if (missing.length) throw new JourneyError(`Journeys with no spec file: ${missing.join(", ")}. Every listed journey must run.`);
  return [...new Set(journeys.map((j) => j.spec!))];
}

/**
 * The secrets the `journeys` stage may use, from the JSON of every secret the workflow
 * received. Only names listed under `secrets.journeys` pass; a listed one that is missing
 * or empty fails, naming the secret, never a value.
 */
export function stageSecrets(config: PipelineConfig, allSecretsJson: string | undefined): Record<string, string> {
  const names = config.secrets[JOURNEYS_STAGE] ?? [];
  if (!names.length) return {};
  let all: Record<string, unknown>;
  try {
    all = JSON.parse(allSecretsJson || "{}");
  } catch {
    throw new JourneyError("Could not read the secrets passed to the journeys step.");
  }
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const v = all[name];
    if (typeof v === "string" && v.length) out[name] = v;
    else missing.push(name);
  }
  if (missing.length) {
    throw new JourneyError(`Secrets listed under secrets.${JOURNEYS_STAGE} but not available: ${missing.join(", ")}. Add them to the repo's GitHub Actions secrets, and pass each one to the kit's workflow by name (secrets: PREVIEW_BYPASS_SECRET: ...).`);
  }
  return out;
}

/** HTTP headers for the preview, values taken from the granted secrets. */
export function previewHeaders(config: PipelineConfig, secrets: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [header, secret] of Object.entries(config.previews?.headers ?? {})) {
    const v = secrets[secret];
    if (!v) throw new JourneyError(`Preview header ${header} needs secret ${secret}, which isn't available to the journeys stage.`);
    out[header] = v;
  }
  return out;
}

/** Environment for the Playwright run: the job's environment minus anything secret, plus the contract. */
export function journeyEnv(url: string, headers: Record<string, string>, secrets: Record<string, string>, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  // The secrets the workflow received arrive as KIT_SECRETS; the job's token isn't needed
  // by journeys. Neither reaches the tests.
  for (const k of ["KIT_SECRETS", "GITHUB_TOKEN", "GH_TOKEN", "INPUT_TOKEN"]) delete env[k];
  return {
    ...env,
    ...secrets,
    CI: base.CI ?? "true",
    PIPELINE_PREVIEW_URL: url,
    PIPELINE_PREVIEW_HEADERS: JSON.stringify(headers),
  };
}

export type Spawn = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => number;

const defaultSpawn: Spawn = (cmd, args, env) => spawnSync(cmd, args, { stdio: "inherit", env }).status ?? 1;

/** Run the journeys with Playwright in the project's checkout. Returns the exit code. */
export function runJourneys(specs: string[], env: NodeJS.ProcessEnv, spawn: Spawn = defaultSpawn): number {
  return spawn("npx", ["--no-install", "playwright", "test", ...specs], env);
}

export function journeysSummary(config: PipelineConfig, url: string, code: number): string {
  const rows = (config.journeys ?? []).map((j) => `| \`${j.id}\` | ${j.description.replace(/\|/g, "\\|")} | \`${j.spec}\` |`);
  return [
    `### Journeys: ${code === 0 ? "passed" : "failed"}`,
    "",
    `Run against the preview at ${url}.${code === 0 ? "" : " Open the job log for the failing step."}`,
    "",
    "| Journey | What it checks | Spec |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
