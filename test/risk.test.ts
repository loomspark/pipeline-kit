import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalState, classify } from "../src/risk.ts";
import { exampleConfig } from "./helpers.ts";
import type { ChangedFile } from "../src/diff.ts";

const files = (...paths: string[]): ChangedFile[] => paths.map((path) => ({ path, status: "M" }));

test("docs-only change is tier 0", () => {
  const r = classify(files("docs/guide.md", "README.md"), exampleConfig());
  assert.equal(r.tier, 0);
});

test("unmatched files take the default tier", () => {
  const r = classify(files("src/app/page.tsx", "docs/guide.md"), exampleConfig());
  assert.equal(r.tier, 1);
  assert.equal(r.files.find((f) => f.path === "src/app/page.tsx")!.rules.length, 0);
});

test("the highest matching rule wins, so a tier-0 rule never downgrades a risky path", () => {
  const r = classify(files("src/auth/README.md"), exampleConfig());
  assert.equal(r.tier, 2);
  assert.equal(r.files[0].rules[0].ref, "FR-AUTH-1");
});

test("deleting a risky file is still risky", () => {
  const r = classify([{ path: "db/migrations/0003_add.sql", status: "D" }], exampleConfig());
  assert.equal(r.tier, 2);
});

test("changing the pipeline config escalates", () => {
  assert.equal(classify(files(".pipeline/config.yml"), exampleConfig()).tier, 2);
});

test("empty change is tier 0", () => {
  assert.equal(classify([], exampleConfig()).tier, 0);
});

test("approval only counts on the event that applies the label", () => {
  const c = exampleConfig();
  assert.equal(approvalState(1, c, { action: "synchronize", labels: [] }), "not-needed");
  assert.equal(approvalState(2, c, { action: "opened", labels: [] }), "needed");
  assert.equal(approvalState(2, c, { action: "labeled", label: "risk:approved", labels: ["risk:approved"] }), "approved");
  // A push after approval, or any other label change, needs the label re-applied.
  assert.equal(approvalState(2, c, { action: "synchronize", labels: ["risk:approved"] }), "stale");
  assert.equal(approvalState(2, c, { action: "labeled", label: "docs", labels: ["risk:approved", "docs"] }), "stale");
  // A PR opened with the label already on it (e.g. by an agent) is not approved.
  assert.equal(approvalState(2, c, { action: "opened", labels: ["risk:approved"] }), "stale");
});
