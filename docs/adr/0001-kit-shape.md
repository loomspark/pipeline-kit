# ADR 0001: Kit shape, boundaries and delivery mechanism

**Status:** Accepted · **Date:** 2026-10-22

## Context

Loomspark wants one delivery pipeline (CI, risk rules, testers, triage, build and review agents) reused across projects: Ward Intel first, Made Impact later, and eventually a Made Impact instance independent of Loomspark's accounts. The plan requires it to be vendor-neutral (no single AI vendor, coding agent or host), cheap, and to keep secrets and project data out of shared code. Ward Intel adds strict privacy rules: no residents' content anywhere outside its redaction pipeline.

All repos involved are private and owned by the `loomspark` user account on GitHub Free.

## Decision

1. **Separate repo, `loomspark/pipeline-kit`, private.** Projects reference it; nothing project-specific lives in it.
2. **One project config file per project, `.pipeline/config.yml`,** validated against a JSON Schema in the kit (`schema/pipeline-config.schema.json`, `version: 1`). YAML for comments; the schema is the contract and is checked at runtime by the CLI, so docs and validation can't drift.
3. **Config names secrets, never holds them.** Secret names are `UPPER_SNAKE_CASE` per stage; the CLI rejects any config line that matches a credential pattern.
4. **Delivery: reusable workflow plus composite action.** Projects call `.github/workflows/ci.yml@v0`; the workflow's steps use the kit's root composite action `loomspark/pipeline-kit@v0`. A reusable workflow in another private repo can't check out the kit's code with the caller's `GITHUB_TOKEN`, but GitHub fetches actions itself once the kit repo allows access from the owner's repos. This needs no PAT, app or secret.
5. **Rules engine is plain TypeScript run by Node type stripping** (no build, no committed `dist/`), two dependencies (`yaml`, `ajv`), and an in-house glob matcher whose `**` includes dotfiles, so `.env` and `.github/` are always seen.
6. **Risk is decided by paths on the real diff, highest tier wins,** independent of any AI rating. Approval is a PR label that counts only on the event that applies it.
7. **Findings never include matched text.** Rule, file and line only.

## Alternatives considered

- **Kit inside each project (copy):** drifts immediately; Made Impact would inherit Ward Intel's quirks.
- **Publishing an npm package:** outward-facing and adds a registry dependency; unnecessary while one owner releases.
- **Checking out the kit in the workflow with a PAT or GitHub App token:** works, but adds a long-lived secret to every project for no gain over action fetching.
- **JavaScript action with bundled `dist/`:** standard, but committed build output is noisy to review and easy to let drift from source.
- **`picomatch`/`minimatch`, or Node's `path.matchesGlob`:** default to skipping dotfiles. Opting back in per call is easy to forget in exactly the security-relevant cases.
- **Approval by PR review:** reviews record the commit they approve, which would be better, but the owner can't approve PRs opened under their own account, which is how agents currently open them. Revisit with a bot identity (K3).

## Consequences

- Any Loomspark-owned repo can call the kit once the kit allows same-owner access. A Made Impact org can't until it pins a copy or forks (K2).
- Projects can pin the workflow to a SHA, but the action inside follows `@v0` (K5).
- Without GitHub Pro, checks are advisory on private repos (K4). The risk check still gates agents, whose instructions say not to merge on red.
- Hard rules are pattern-based and only catch what can be expressed as paths or regexes. Judgement-based privacy review is the reviewer agent's job (milestone 5).
