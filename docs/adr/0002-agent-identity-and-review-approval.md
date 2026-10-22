# ADR 0002: Agent identity, review-based approval and a risk status

**Status:** Accepted · **Date:** 2026-10-22 · **Amends:** ADR 0001 §6 (approval)

## Context

In v0, agents worked through the owner's GitHub account, so GitHub couldn't tell an agent's action from the owner's. A label "approved" the change, but nothing proved who applied it (K3). The owner also had to visit a PR on GitHub to approve, and wants approvals to reach them (for example on their phone) with an audit trail that doesn't rest on trusting an agent's word.

A second problem: when an approval arrives without a new push, a check that failed earlier stays red unless the whole workflow reruns. Separate check runs per event leave the old failure visible.

## Decision

1. **Agents get their own identity: a GitHub App,** created by the owner and installed only on the repos agents work in. Its permissions are contents and pull requests (read and write), plus read-only actions, checks and statuses. It has **no `workflows` permission**, so agents can't change CI. `pipeline-kit agent git|gh` mints a short-lived, single-repo installation token from the app's key and runs the command with it, with stored credentials disabled (`docs/agent-identity.md`).
2. **Approval by GitHub review** (`risk.approval.method: review`, with `approvers` listing people's logins). A change is approved when a listed approver's latest decisive review approves the PR's current head commit. GitHub records the reviewer and the commit, so approval is attributable and tied to a version, and a later push makes it stale. Reviews from the app or anyone not listed don't count. The label method stays for projects not yet using an agent identity, and gains the same check on who applied the label.
3. **The risk result is a commit status** (`pipeline-kit/risk`) on the head commit, updated in place by every run. The risk job reruns on `pull_request_review` events, so an approval turns the status green without a push, and no stale red check is left behind. The job itself passes whenever it reported successfully; the status is the gate.
4. **The approver is asked, not expected to look.** When approval is needed, the risk job requests a review from the approvers (GitHub notifies them, including on mobile). It keeps one PR comment up to date in plain English: why approval is needed, how to approve, and who approved. The PR description carries the agent's plain-English summary of the change.
5. **Released as `v1`.** Callers must grant `pull-requests: write` and `statuses: write` and listen for `pull_request_review`. `v0` stays as it was.

## Alternatives considered

- **Machine user (a second GitHub account) instead of an app:** simpler tokens, but it's a whole account with a password, needs a paid seat in an org, and its permissions are coarser.
- **Approve in chat and let the agent apply the label:** the most fluid, but the approval would rest on the agent relaying it honestly. Rejected by the owner (22 Oct 2026): traceability must come from GitHub's records.
- **Custom approval service (web page or bot with an approve button):** possible later for unattended agents; GitHub reviews plus the mobile app already give a one-tap, attributable approval for free.
- **Re-running the failed check run via the API on review:** needs `actions: write` and leaves a confusing history.

## Consequences

- An agent can't approve its own work: any review it submits is ignored, and approval is checked against GitHub's record of the reviewer.
- The owner approves from the GitHub app with one tap. Every approval is a review linked from the PR comment and the status.
- On the owner's laptop, agents could still reach the owner's own login; making that impossible means running agents where only the app key exists (K7).
- CI changes (`.github/workflows/**`) can only be pushed by a person.
