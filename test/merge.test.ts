import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHub } from "../src/github.ts";
import { guardedMerge, mergeDecision } from "../src/merge.ts";
import type { CheckRun, CommitStatus, PullInfo } from "../src/merge.ts";
import { fakeGitHub } from "./helpers.ts";

const head = "c".repeat(40);
const pr: PullInfo = { number: 5, state: "open", draft: false, merged: false, mergeable: true, headSha: head };
const run = (id: number, name: string, conclusion: string | null, status = "completed"): CheckRun => ({ id, name, status, conclusion });
const green: CheckRun[] = [run(1, "pipeline / verify", "success"), run(2, "pipeline / hard-rules", "success"), run(3, "pipeline / risk", "success")];
const riskOk: CommitStatus = { context: "pipeline-kit/risk", state: "success", description: "Tier 1 (auto-build): no approval needed" };

test("all green, risk green: merge", () => {
  const d = mergeDecision(pr, green, [riskOk, { context: "Vercel", state: "success" }]);
  assert.equal(d.ok, true, d.reasons.join("; "));
});

test("risky change waiting for the owner: refuse", () => {
  const d = mergeDecision(pr, green, [{ context: "pipeline-kit/risk", state: "failure", description: "Tier 2 (escalate): waiting for @example-owner" }]);
  assert.equal(d.ok, false);
  assert.match(d.reasons.join(), /pipeline-kit\/risk.*waiting for @example-owner.*is failure/);
});

test("no risk status at all (project not on the kit, or it hasn't run): refuse", () => {
  assert.match(mergeDecision(pr, green, []).reasons.join(), /no pipeline-kit\/risk status/);
});

test("failed, running or missing checks: refuse", () => {
  assert.match(mergeDecision(pr, [...green, run(4, "pipeline / verify", "failure")], [riskOk]).reasons.join(), /verify" failure/);
  assert.match(mergeDecision(pr, [run(1, "pipeline / verify", null, "in_progress")], [riskOk]).reasons.join(), /still running/);
  assert.match(mergeDecision(pr, [], [riskOk]).reasons.join(), /no checks have run/);
  assert.match(mergeDecision(pr, green, [riskOk, { context: "Vercel", state: "pending" }]).reasons.join(), /Vercel" is pending/);
});

test("a later skipped run never hides an earlier failure; a later success does replace it", () => {
  const failedThenSkipped = [run(1, "pipeline / verify", "failure"), run(9, "pipeline / verify", "skipped")];
  assert.equal(mergeDecision(pr, failedThenSkipped, [riskOk]).ok, false);
  const failedThenFixed = [run(1, "pipeline / verify", "failure"), run(9, "pipeline / verify", "success")];
  assert.equal(mergeDecision(pr, failedThenFixed, [riskOk]).ok, true);
  assert.equal(mergeDecision(pr, [run(1, "pipeline / verify", "skipped")], [riskOk]).ok, true);
});

test("draft, closed, conflicted or already merged: refuse", () => {
  assert.match(mergeDecision({ ...pr, draft: true }, green, [riskOk]).reasons.join(), /draft/);
  assert.match(mergeDecision({ ...pr, state: "closed" }, green, [riskOk]).reasons.join(), /closed/);
  assert.match(mergeDecision({ ...pr, mergeable: false }, green, [riskOk]).reasons.join(), /conflicts/);
  assert.match(mergeDecision({ ...pr, merged: true, state: "closed" }, green, [riskOk]).reasons.join(), /already merged/);
});

const repo = "example-org/example-app";
function fake(statusList: CommitStatus[], mergeResponse: () => unknown = () => ({ sha: "d".repeat(40) })) {
  return fakeGitHub({
    [`GET /repos/${repo}/pulls/5`]: () => ({ number: 5, state: "open", draft: false, merged: false, mergeable: true, head: { sha: head } }),
    [`GET /repos/${repo}/commits/${head}/check-runs`]: () => ({ check_runs: green }),
    [`GET /repos/${repo}/commits/${head}/status`]: () => ({ statuses: statusList }),
    [`PUT /repos/${repo}/pulls/5/merge`]: mergeResponse,
  });
}

test("guarded merge pins the merge to the head it checked", async () => {
  const gh = fake([riskOk]);
  const r = await guardedMerge(new GitHub({ token: "t", repo, fetch: gh.fetch }), 5);
  assert.equal(r.merged, true, r.message);
  const put = gh.calls.find((c) => c.method === "PUT")!;
  assert.deepEqual(put.body, { merge_method: "merge", sha: head });
});

test("guarded merge never calls merge when refused", async () => {
  const gh = fake([{ context: "pipeline-kit/risk", state: "failure" }]);
  const r = await guardedMerge(new GitHub({ token: "t", repo, fetch: gh.fetch }), 5);
  assert.equal(r.merged, false);
  assert.equal(gh.calls.some((c) => c.method === "PUT"), false);
});
