import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { parse } from "yaml";
import { PRESETS } from "./presets.ts";
import { globToRegExp } from "./glob.ts";
import type { HardRule, PipelineConfig } from "./types.ts";

export const DEFAULT_CONFIG_PATH = ".pipeline/config.yml";

const schema = JSON.parse(
  readFileSync(new URL("../schema/pipeline-config.schema.json", import.meta.url), "utf8"),
);
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

export class ConfigError extends Error {}

export function parseConfig(text: string, source = DEFAULT_CONFIG_PATH): PipelineConfig {
  let data: unknown;
  try {
    data = parse(text);
  } catch (e) {
    throw new ConfigError(`${source}: not valid YAML (${(e as Error).message.split("\n")[0]})`);
  }
  if (!validate(data)) {
    const problems = (validate.errors ?? []).map((e) => `  ${e.instancePath || "/"} ${e.message}`);
    throw new ConfigError(`${source} does not match the config schema:\n${[...new Set(problems)].join("\n")}`);
  }
  const config = withDefaults(data as PipelineConfig);
  checkSemantics(config, text, source);
  return config;
}

// Defaults are documented in the schema and applied here, so they hold whatever the
// validator does with `default` (Ajv skips it beside $ref and inside omitted objects).
function withDefaults(c: PipelineConfig): PipelineConfig {
  c.verify.nodeVersionFile ??= ".nvmrc";
  c.verify.install ??= "npm ci";
  c.risk.enforce ??= true;
  c.risk.defaultTier ??= 1;
  const approval: Partial<PipelineConfig["risk"]["approval"]> = c.risk.approval ?? {};
  c.risk.approval = {
    method: approval.method ?? "label",
    approvers: approval.approvers ?? [],
    requestReview: approval.requestReview ?? true,
    label: approval.label ?? "risk:approved",
    fromTier: approval.fromTier ?? 2,
  };
  const hard: Partial<PipelineConfig["hardRules"]> = c.hardRules ?? {};
  c.hardRules = { presets: hard.presets ?? [], rules: hard.rules ?? [] };
  c.secrets ??= {};
  if (c.previews) {
    c.previews.timeoutMinutes ??= 10;
    c.previews.headers ??= {};
  }
  return c;
}

export function loadConfig(path = DEFAULT_CONFIG_PATH): PipelineConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`No pipeline config at ${path}. See the kit's docs/design.md#project-config.`);
  }
  return parseConfig(text, path);
}

/** Preset rules first, then the project's own. */
export function allHardRules(config: PipelineConfig): HardRule[] {
  return [...config.hardRules.presets.flatMap((p) => PRESETS[p] ?? []), ...config.hardRules.rules];
}

function checkSemantics(config: PipelineConfig, text: string, source: string): void {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const rule of allHardRules(config)) {
    if (ids.has(rule.id)) problems.push(`hard rule id "${rule.id}" is used twice`);
    ids.add(rule.id);
    for (const p of rule.forbidPatterns ?? []) {
      try {
        new RegExp(p);
      } catch {
        problems.push(`hard rule "${rule.id}": invalid regular expression ${JSON.stringify(p)}`);
      }
    }
  }
  const globs = [
    ...config.risk.rules.flatMap((r) => r.paths),
    ...config.hardRules.rules.flatMap((r) => [...r.paths, ...(r.exceptPaths ?? [])]),
  ];
  for (const g of globs) {
    try {
      globToRegExp(g);
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  // Journeys need a preview to run against, and a header may only use a secret its stage
  // is granted, so secrets.journeys stays the one place that grants access.
  if (config.journeys?.length && (!config.previews || config.previews.source === "none")) {
    problems.push("journeys are listed but previews is missing or none: journeys run against a preview");
  }
  const granted = new Set(config.secrets.journeys ?? []);
  for (const [header, secret] of Object.entries(config.previews?.headers ?? {})) {
    if (!granted.has(secret)) problems.push(`previews.headers.${header} uses secret ${secret}, which isn't listed under secrets.journeys`);
  }
  // The config names secrets; it must never hold one. Report line numbers only.
  const credential = PRESETS.secrets.find((r) => r.id === "secrets-credential")!;
  const res = credential.forbidPatterns!.map((p) => new RegExp(p));
  text.split("\n").forEach((line, i) => {
    if (res.some((re) => re.test(line))) problems.push(`line ${i + 1} looks like a secret value; config may only name secrets`);
  });
  if (problems.length) throw new ConfigError(`${source}:\n${problems.map((p) => `  ${p}`).join("\n")}`);
}
