import { test } from "node:test";
import assert from "node:assert/strict";
import { riskComment, riskStatusDescription } from "../src/report.ts";
import { classify } from "../src/risk.ts";
import { exampleConfig } from "./helpers.ts";

const config = exampleConfig();
config.risk.approval.method = "review";
config.risk.approval.approvers = ["example-owner"];
const result = classify([{ path: "db/migrations/0002.sql", status: "A" }, { path: "docs/x.md", status: "M" }], config);

test("status descriptions say who approved, or who is awaited", () => {
  assert.equal(riskStatusDescription(2, { status: "needed" }, config), "Tier 2 (escalate): waiting for @example-owner");
  assert.equal(riskStatusDescription(2, { status: "approved", by: "example-owner" }, config), "Tier 2 (escalate): approved by @example-owner");
  assert.equal(riskStatusDescription(2, { status: "stale" }, config), "Tier 2 (escalate): new changes since approval; waiting for @example-owner");
  assert.equal(riskStatusDescription(1, { status: "not-needed" }, config), "Tier 1 (auto-build): no approval needed");
});

test("the PR comment explains why and how to approve, then records who did", () => {
  const waiting = riskComment(result, { status: "needed" }, config);
  assert.match(waiting, /Why it needs approval:\*\* it changes schema, CI or pipeline config\./);
  assert.match(waiting, /Review changes → Approve/);
  assert.match(waiting, /`db\/migrations\/0002.sql`/);
  const done = riskComment(result, { status: "approved", by: "example-owner", evidence: "https://github.example.invalid/r/1" }, config);
  assert.match(done, /✅/);
  assert.match(done, /Approved by @example-owner \(\[review\]\(https:\/\/github.example.invalid\/r\/1\)\), for this exact version\./);
  assert.doesNotMatch(done, /To approve/);
});
