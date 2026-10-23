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

const ev = (action: string, labels: string[] = [], label?: string, actor = "example-owner") => ({ action, labels, label, actor });

test("label approval only counts on the event that applies it", () => {
  const c = exampleConfig();
  const st = (tier: 0 | 1 | 2, e: ReturnType<typeof ev>) => approvalState(tier, c, e).status;
  assert.equal(st(1, ev("synchronize")), "not-needed");
  assert.equal(st(2, ev("opened")), "needed");
  assert.deepEqual(approvalState(2, c, ev("labeled", ["risk:approved"], "risk:approved")), { status: "approved", by: "example-owner" });
  // A push after approval, or any other label change, needs the label re-applied.
  assert.equal(st(2, ev("synchronize", ["risk:approved"])), "stale");
  assert.equal(st(2, ev("labeled", ["risk:approved", "docs"], "docs")), "stale");
  // A PR opened with the label already on it (e.g. by an agent) is not approved.
  assert.equal(st(2, ev("opened", ["risk:approved"])), "stale");
});

test("label approval from someone who isn't an approver doesn't count", () => {
  const c = exampleConfig();
  c.risk.approval.approvers = ["Example-Owner"];
  assert.equal(approvalState(2, c, ev("labeled", ["risk:approved"], "risk:approved", "example-agent[bot]")).status, "stale");
  assert.equal(approvalState(2, c, ev("labeled", ["risk:approved"], "risk:approved", "example-owner")).status, "approved");
});

test("review approval: an approver's latest decisive review must approve the current head", () => {
  const c = exampleConfig();
  c.risk.approval.method = "review";
  c.risk.approval.approvers = ["example-owner"];
  const head = "b".repeat(40);
  const old = "a".repeat(40);
  const st = (reviews: { user: string; state: string; commit: string }[]) => approvalState(2, c, ev("submitted"), { head, reviews });

  assert.equal(st([]).status, "needed");
  assert.deepEqual(st([{ user: "example-owner", state: "APPROVED", commit: head }]), { status: "approved", by: "example-owner", evidence: undefined });
  // Approved an earlier version: stale.
  assert.equal(st([{ user: "example-owner", state: "APPROVED", commit: old }]).status, "stale");
  // Agents, or anyone not listed, can't approve.
  assert.equal(st([{ user: "example-agent[bot]", state: "APPROVED", commit: head }]).status, "needed");
  // A later "request changes" or dismissal withdraws approval; a comment doesn't.
  assert.equal(st([{ user: "example-owner", state: "APPROVED", commit: head }, { user: "example-owner", state: "CHANGES_REQUESTED", commit: head }]).status, "needed");
  assert.equal(st([{ user: "example-owner", state: "APPROVED", commit: head }, { user: "example-owner", state: "DISMISSED", commit: head }]).status, "needed");
  assert.equal(st([{ user: "example-owner", state: "APPROVED", commit: head }, { user: "example-owner", state: "COMMENTED", commit: head }]).status, "approved");
  // Login case doesn't matter.
  assert.equal(st([{ user: "Example-Owner", state: "APPROVED", commit: head }]).status, "approved");
  // Without review data (e.g. run locally) it fails closed.
  assert.equal(approvalState(2, c, ev("submitted")).status, "needed");
});
