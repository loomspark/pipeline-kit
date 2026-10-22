# Open questions

Undecided points about the kit. When one is resolved, move it to the bottom with the decision and date, and update `design.md`.

| # | Question | Whose call |
|---|---|---|
| K1 | **Licence and ownership.** The kit is built by Loomspark on the owner's own time. Agree ownership and licensing with Made Impact before their work depends on it (plan, "Pipeline kit"). Until then: all rights reserved, repo private. | Owner |
| K2 | **How Made Impact consumes it.** Pinned reference to Loomspark's kit, or a fork in Made Impact's org. A Made Impact org can't call actions in a private repo owned by another account, so referencing needs the kit public, or a mirror. Decide at adoption. | Owner, with Made Impact |
| K3 | **Agent identity.** Agents act through the owner's GitHub account today, so a label or comment can't prove a human approved. Proposal (milestone 2): agents use a GitHub App or machine user; approval then checks the actor who applied the label (or uses PR reviews, which also record the commit). | Owner (new account or app) |
| K4 | **Enforcing checks.** GitHub Free doesn't allow branch protection or rulesets on private repos, so checks can't be made required. Options: GitHub Pro for the owner account ($4/month), making repos public, or relying on agent rules plus the owner's own discipline. | Owner (money) |
| K5 | **Exact pinning.** The workflow's internal `uses: loomspark/pipeline-kit@v0` can't follow the caller's pin. Options: release tooling that rewrites internal refs to the exact tag on release, or moving the steps into the workflow itself. Matters once someone other than the kit's owner releases or consumes it. | Kit |
| K6 | **Lockfile exception.** The plan exempts Dependabot patch bumps from lockfile escalation. Needs a rule condition (author is Dependabot, only patch-level versions changed). Milestone 2. | Kit |

## Resolved

None yet.
