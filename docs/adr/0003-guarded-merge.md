# ADR 0003: Agents merge only through a guarded merge

**Status:** Accepted · **Date:** 2026-10-26 · **Builds on:** ADR 0002

## Context

The owner wants low-risk changes to merge without their review, and risky changes to merge as soon as they've approved. A plain permission rule letting agents run `gh pr merge` can't tell the difference: it would rest on the agent checking first. GitHub Free can't enforce required checks or auto-merge on private repos (K4).

## Decision

1. **`pipeline-kit agent merge <pr>`** merges as the agent identity only when GitHub's records say so:
   - the PR is open, not a draft and has no conflicts;
   - every check run on the head commit has finished, judged by its latest run that ran (a later skipped run never hides an earlier failure);
   - every commit status on the head is `success`, including `pipeline-kit/risk`, which means low risk, or approved by a listed approver for this exact commit.

   The merge call is pinned to the checked head SHA, so GitHub refuses it if anything was pushed in between. Merge commits, as in the projects' history.
2. **`agent gh pr merge` is refused** and points to the guarded command, so there is one way for agents to merge.
3. **The owner's Claude Code settings allow only the guarded command,** by its exact path (`docs/agent-identity.md#merging`). Raw merges stay behind a prompt or are denied.
4. The kit's own PRs move to `approval.method: review`, now that the agent opens them.

## Consequences

- Low-risk changes (tier 0 and 1 under current rules) merge with no human step once green. Risky ones merge once the owner approves on their phone.
- Merges are recorded as `loomspark-agent[bot]`. Changes to `.github/workflows/**` can't be merged by the agent (no workflows permission); the owner merges those.
- It runs only while an agent session is running on the owner's machine; nothing merges unattended. A GitHub-side merge job is for when agents run unattended (milestone 6).
- Which tiers merge without review is set by `risk.approval.fromTier` in each project's config, itself a tier-2 file.
