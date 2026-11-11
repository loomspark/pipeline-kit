# Open questions

Undecided points about the kit. When one is resolved, move it to the bottom with the decision and date, and update `design.md`.

| # | Question | Whose call |
|---|---|---|
| K1 | **Licence and ownership.** The kit is built by Loomspark on the owner's own time. Agree ownership and licensing with Made Impact before their work depends on it (plan, "Pipeline kit"). Until then: all rights reserved, repo private. | Owner |
| K2 | **How Made Impact consumes it.** Pinned reference to Loomspark's kit, or a fork in Made Impact's org. A Made Impact org can't call actions in a private repo owned by another account, so referencing needs the kit public, or a mirror. Decide at adoption. | Owner, with Made Impact |
| K4 | **Enforcing checks.** GitHub Free doesn't allow branch protection or rulesets on private repos, so checks can't be made required. Options: GitHub Pro for the owner account ($4/month), making repos public, or relying on agent rules plus the owner's own discipline. | Owner (money) |
| K5 | **Exact pinning.** The workflow's internal `uses: loomspark/pipeline-kit@v1` can't follow the caller's pin. Options: release tooling that rewrites internal refs to the exact tag on release, or moving the steps into the workflow itself. Matters once someone other than the kit's owner releases or consumes it. | Kit |
| K6 | **Lockfile exception.** The plan exempts Dependabot patch bumps from lockfile escalation. Needs a rule condition (author is Dependabot, only patch-level versions changed). Milestone 2 follow-up. | Kit |
| K7 | **Where agents run.** On the owner's laptop an agent session can still reach the owner's own GitHub login, so "agents act only as the agent identity" is a convention there (the approval check itself doesn't rely on it). Options: run agent sessions in the cloud with only the app key; a separate macOS user for agents; or deny `gh auth`/keychain access in the agent's permission settings. Decide before agents run unattended. | Owner |
| K8 | **Who runs the approval service (ADR 0006).** It's the kit's first running service and holds the approver app's key, so it's as sensitive as an approver's GitHub account. One shared service for all projects, or one per organisation (Made Impact's own)? Which host, who has access to its secrets, and what happens if it's down? Failing closed is the default: nothing gets approved. | Owner, with Made Impact |
| K9 | **What counts as "involved" (ADR 0006).** The fast lane is for approvers who shaped the change. Candidate signals: they opened the intake issue, they commented on it or on the PR, or they were in the conversation the agent worked from. It must be a record the agent can't fake. Until there's one, everything uses the full lane. | Owner |
| K10 | **WhatsApp setup (ADR 0006).** The Business Platform needs a verified Meta business account, a dedicated number and pre-approved templates for messages a business starts (change ready, approved and live, something failed). Whose account and number: Made Impact's or Loomspark's? Telegram and email need none of this. | Made Impact |
| K11 | **Rolling back database changes (ADR 0006).** Restoring an earlier deploy doesn't undo a migration. Options: require additive-only migrations so the previous code still works; require a tested down migration for tier-2 changes; or mark such changes "can't be undone with one tap" on the approval page. | Owner |

## Resolved

| # | Question | Decision (date) |
|---|---|---|
| K3 | **Agent identity.** Agents acted through the owner's GitHub account, so a label couldn't prove a human approved. | **GitHub App identity for agents; approval by a listed approver's GitHub review on the exact head commit (2026-10-22, owner; ADR 0002).** Approval in chat relayed by an agent was rejected: traceability must come from GitHub's records. |
