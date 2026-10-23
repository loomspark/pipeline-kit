import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allHardRules, ConfigError, parseConfig } from "../src/config.ts";
import { EXAMPLE_YAML, exampleConfig, fake } from "./helpers.ts";

test("applies schema defaults", () => {
  const c = exampleConfig();
  assert.equal(c.verify.install, "npm ci");
  assert.equal(c.verify.nodeVersionFile, ".nvmrc");
  assert.equal(c.risk.enforce, true);
  assert.equal(c.risk.defaultTier, 1);
  assert.deepEqual(c.risk.approval, { method: "label", approvers: [], requestReview: true, label: "risk:approved", fromTier: 2 });
  assert.deepEqual(c.secrets, {});
});

test("presets come before project rules", () => {
  const ids = allHardRules(exampleConfig()).map((r) => r.id);
  assert.deepEqual(ids, ["secrets-env-file", "secrets-credential", "no-exports", "no-tracker"]);
});

test("the shipped example config is valid", () => {
  const text = readFileSync(new URL("../examples/pipeline.config.yml", import.meta.url), "utf8");
  assert.doesNotThrow(() => parseConfig(text, "examples/pipeline.config.yml"));
});

test("the kit's own config is valid", () => {
  const text = readFileSync(new URL("../.pipeline/config.yml", import.meta.url), "utf8");
  assert.doesNotThrow(() => parseConfig(text, ".pipeline/config.yml"));
});

test("rejects unknown keys and bad tiers", () => {
  assert.throws(() => parseConfig(EXAMPLE_YAML + "surprise: true\n"), ConfigError);
  assert.throws(() => parseConfig(EXAMPLE_YAML.replace("tier: 0", "tier: 3")), ConfigError);
});

test("secrets are names only", () => {
  assert.doesNotThrow(() => parseConfig(EXAMPLE_YAML + "secrets:\n  build: [MODEL_API_KEY]\n"));
  assert.throws(() => parseConfig(EXAMPLE_YAML + "secrets:\n  build: [model-api-key]\n"), ConfigError);
});

test("a secret value anywhere in the config is rejected, by line, without echoing it", () => {
  const value = fake.anthropic();
  const text = EXAMPLE_YAML + `previews:\n  source: command\n  command: 'curl -H "x-key: ${value}" https://ci.example.invalid'\n`;
  assert.throws(
    () => parseConfig(text),
    (e: Error) => e instanceof ConfigError && /line \d+ looks like a secret/.test(e.message) && !e.message.includes(value),
  );
});

test("rejects duplicate rule ids and invalid regexes", () => {
  const dup = EXAMPLE_YAML.replace("id: no-tracker", "id: no-exports");
  assert.throws(() => parseConfig(dup), /used twice/);
  const badRe = EXAMPLE_YAML.replace('forbidPatterns: ["tracker', 'forbidPatterns: ["(tracker');
  assert.throws(() => parseConfig(badRe), /invalid regular expression/);
});

test("a hard rule must forbid something", () => {
  const text = EXAMPLE_YAML.replace("      forbidFile: true\n", "");
  assert.throws(() => parseConfig(text), ConfigError);
});

test("review approval needs at least one approver", () => {
  const base = EXAMPLE_YAML.replace("risk:\n  rules:", "risk:\n  approval:\n    method: review\nAPPROVERS  rules:");
  assert.throws(() => parseConfig(base.replace("APPROVERS", "")), ConfigError);
  assert.throws(() => parseConfig(base.replace("APPROVERS", "    approvers: []\n")), ConfigError);
  const ok = parseConfig(base.replace("APPROVERS", "    approvers: [example-owner]\n"));
  assert.equal(ok.risk.approval.method, "review");
  assert.deepEqual(ok.risk.approval.approvers, ["example-owner"]);
});
