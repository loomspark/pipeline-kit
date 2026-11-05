# Open questions

Undecided points about the kit. When one is resolved, move it to the bottom with the decision and date, and update `design.md`.

| # | Question | Whose call |
|---|---|---|
| K1 | **Licence and ownership.** The kit is built by Loomspark on the owner's own time. Agree ownership and licensing with Made Impact before their work depends on it (plan, "Pipeline kit"). Until then: all rights reserved, repo private. | Owner |
| K2 | **How Made Impact consumes it.** Pinned reference to Loomspark's kit, or a fork in Made Impact's org. A Made Impact org can't call actions in a private repo owned by another account, so referencing needs the kit public, or a mirror. Decide at adoption. | Owner, with Made Impact |
| K4 | **Enforcing checks.** GitHub Free doesn't allow branch protection or rulesets on private repos, so checks can't be made required. Options: GitHub Pro for the owner account ($4/month), making repos public, or relying on agent rules plus the owner's own discipline. | Owner (money) |
| K5 | **Exact pinning.** The workflow's internal `uses: loomspark/pipeline-kit@v1` can't follow the caller's pin. Options: release tooling that rewrites internal refs to the exact tag on release, or moving the steps into the workflow itself. Matters once someone other than the kit's owner releases or consumes it. | Kit |
| K6 | **Lockfile exception.** The plan exempts Dependabot patch bumps from lockfile escalation. Needs a rule condition (author is Dependabot, only patch-level versions changed). Milestone 2 follow-up. | Kit |

## Resolved

| # | Question | Decision (date) |
|---|---|---|
| K3 | **Agent identity.** Agents acted through the owner's GitHub account, so a label couldn't prove a human approved. | **GitHub App identity for agents; approval by a listed approver's GitHub review on the exact head commit (2026-10-22, owner; ADR 0002).** Approval in chat relayed by an agent was rejected: traceability must come from GitHub's records. |
| K7 | **Where agents run.** On the owner's laptop an agent session could reach the owner's own GitHub login, so "agents act only as the agent identity" was a convention there. | **Unattended agents run on a separate machine (currently a Mac Mini running Marvin) that holds only the agent key and no personal login; changes to the kit itself are made only from the owner's laptop (2026-11-05, owner; ADR 0005).** A second GitHub App for the unattended agent, not installed on `pipeline-kit`, is **[Proposed]**. |
