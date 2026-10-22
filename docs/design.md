# Pipeline kit: design

**Owner:** Rob Scott (Loomspark) · **Started:** 22 Oct 2026 · **First project:** Ward Intel

Background and the wider plan: the "Pipeline kit" section of Made Impact's `docs/ai-pipeline-plan.md` (made-impact-db). This doc is the source of truth for the kit itself.

## 1. Purpose

Take the owner out of the loop for routine change, across several projects, without tying any of them to one AI vendor or host. The kit holds everything reusable; each project holds one config file and a thin caller workflow.

Principles carried over from the plan:

1. **Verification before autonomy.** Each step of automation switches on only once tests can show it's safe.
2. **AI judges intent, rules check reality.** Triage may rate a request, but path-based risk rules on the actual diff decide escalation.
3. **Untrusted input never reaches the builder.** (Phase 3.)
4. **No production credentials in the pipeline.**
5. **Vendor-neutral.** Durable assets are plain files: config, rules, tests, workflows. Models sit behind a gateway; the coding agent is a swappable CLI step; previews are just URLs.
6. **Cheap.** Deterministic checks and tests run free in CI; models only where judgement is needed.
7. **Autonomy goes up a tier at a time.**

The fixed guardrails are in [`CLAUDE.md`](../CLAUDE.md).

## 2. Shape

```
loomspark/pipeline-kit                    project repo (e.g. loomspark/wardintel)
├── .github/workflows/ci.yml  ◄────uses── .github/workflows/ci.yml   (thin caller)
├── action.yml  (composite; runs src/cli.ts)
├── src/        rules engine, CLI           .pipeline/config.yml      (project config)
├── schema/     config contract
└── examples/   fictional example config
```

- **Reusable workflow** (`.github/workflows/ci.yml`): the jobs. Called by projects at `@v0`.
- **Composite action** (`action.yml`): runs one CLI command in the caller's checkout. The workflow uses it as `loomspark/pipeline-kit@v0`. This is how the kit's code reaches a private caller: GitHub fetches the action itself, so no cross-repo token is needed (ADR 0001).
- **CLI** (`src/cli.ts`): `validate`, `plan`, `hard-rules`, `risk`. Runs the same locally and in CI.
- **Schema** (`schema/pipeline-config.schema.json`): the config contract, validated on every run.

## 3. Project config

`.pipeline/config.yml` in the project repo. Full contract: the schema. Sections:

| Section | Milestone | What it declares |
|---|---|---|
| `version` | 0 | Config format, currently `1` |
| `project` | 0 | Name (kebab-case), description |
| `verify` | 1 | `nodeVersionFile` (default `.nvmrc`), `install` (default `npm ci`), `commands`: named shell commands every change must pass |
| `risk` | 1 | `rules` (tier, paths, reason, ref), `defaultTier` (default 1), `approval` (`label` default `risk:approved`, `fromTier` default 2), `enforce` (default true) |
| `hardRules` | 1 | `presets` (kit rule sets, currently `secrets`) and project `rules` |
| `previews` | reserved | `source: deployment` (read the GitHub deployment status a host posts, filtered by `environment`), `command`, or `none` |
| `journeys` | reserved | Key journeys for the fixed end-to-end suite |
| `testData` | reserved | Commands to reset and seed fictional test data |
| `models` | reserved | `gatewayUrl` (any OpenAI-compatible gateway) and a model id per agent role |
| `secrets` | 0 (names), later (use) | Per stage, the **names** of secrets the stage may use. Values never appear in config |

Reserved sections are validated now so projects can declare them early; nothing consumes them yet.

**Secrets.** Names must be `UPPER_SNAKE_CASE`. The kit rejects a config file containing anything that matches the credential patterns, reporting the line number only. When stages that need secrets arrive (milestone 3+) **[Proposed]**: the stage's workflow receives the caller's secrets and the kit exports only the names listed for that stage into the job, so the config is the one place that grants a stage access to a secret, and granting one is a `.pipeline/**` change, which is tier 2.

### Globs

Used by risk and hard rules. Anchored at the repo root: `*.md` matches root files only, `**/*.md` any depth. `**` spans any number of segments and **includes dotfiles and dot-directories** (`.env`, `.github/`), unlike most glob libraries' defaults; that is deliberate for a security check. `*` stays within a segment, `?` is one character, `{a,b}` alternatives, `[abc]` and `[!abc]` classes. Implemented in `src/glob.ts` (no dependency) with tests.

## 4. Checks (milestone 1)

### verify

Checks out the project, reads the plan from config, sets up the project's Node from `nodeVersionFile` (with npm caching when `package-lock.json` exists), runs `install`, then runs every command in order. All commands run even if one fails, so one run reports everything; the job fails if any failed. Each command's result goes in the job summary. No secrets are available.

### hard-rules

Runs on every PR (base...head) and every push to the default branch (before...after). Checks only **added or modified files** and **added lines**, so a change that removes a violation always passes and existing history doesn't block new work.

- `forbidFile: true`: any added or modified file matching `paths` (minus `exceptPaths`) fails.
- `forbidPatterns`: an added line matching any regex, in a matching file, fails (`ignoreCase` optional).

Findings become error annotations and a summary table with **rule, file and line only**. The matched text is never printed. Exemptions are made with `exceptPaths` in the config, which is itself a tier-2 path, so loosening a rule always needs approval. There are deliberately no inline "allow" comments.

The `secrets` preset forbids `.env` files (except `.env.example`) and catches common credential formats: private keys, Anthropic, OpenAI-style, Google, GitHub, Slack, AWS and Stripe live keys, SendGrid keys, and database URLs with an inline password (obvious placeholders excepted). It is a backstop, not a replacement for host secret scanning.

### risk

Runs on PRs only.

<a id="risk-tiers"></a>**Tiers** (from the plan):

| Tier | Name | Pipeline behaviour (target) |
|---|---|---|
| 0 | auto-ship | Build, test, merge and deploy without a human, once enabled per project |
| 1 | auto-build | Build and test automatically; a human approves the merge |
| 2 | escalate | A human approves before the build and again at merge |

**Classification.** A changed file takes the **highest** tier among the rules matching it, or `defaultTier` if none match. The change takes the highest tier of its files. Because the highest tier wins, a broad tier-0 rule (`**/*.md`) can never downgrade a risky path (`src/auth/README.md`). Deleted files count: removing a migration or auth module is as risky as editing it. Renames count both paths. An empty change is tier 0.

**Approval.** When the tier is at or above `approval.fromTier`, the check fails until an approver applies the approval label. Approval counts **only on the `labeled` event that applies the label**, so it always refers to the head the approver looked at. Any later event (a new push, another label added or removed) reruns the check and reports the approval as stale; the approver removes and re-applies the label. This fails closed without needing any API access. With `enforce: false` the check reports only.

Outputs: `tier` (0 to 2) and `approval` (`not-needed`, `approved`, `needed`, `stale`), plus a job summary listing every file with its tier and reason.

**Limits today.** GitHub Free can't make checks *required* on private repos, so a red risk check informs people and agents but doesn't physically block a merge (K4). Agents currently act through the owner's GitHub account, so the label can't prove a human applied it (K3). Agents are bound by the CLAUDE.md rule never to apply it.

## 5. Adopting the kit

1. Add `.pipeline/config.yml` (start from `examples/pipeline.config.yml`). Put the config, workflows, migrations, auth, payments, personal-data code, outbound email, new third-party services, security headers, lockfiles and anything legal at tier 2.
2. Add the caller workflow (see README). Triggers must include `labeled` and `unlabeled` so approval reruns the check.
3. Create the approval label in the repo.
4. In the project's `CLAUDE.md`, tell agents: a failing risk check means "wait for the owner"; never apply the approval label.
5. The kit repo is private, so it must allow access from the project's repos (kit repo: Settings > Actions > General > Access). Done for repos owned by `loomspark`.

## 6. Versioning

- Projects call `ci.yml@v0`; inside, the workflow uses the action at `@v0`. A release is a `v0.x.y` tag plus moving `v0` to it, so both move together.
- A project can pin the workflow to an exact tag or SHA, but the action reference inside it still follows `@v0` (GitHub doesn't allow an expression in `uses:`). Acceptable while one owner releases both; revisit before Made Impact depends on it (K5).
- The kit's own CI (`self-check.yml`) runs the action from the PR's checkout (`uses: ./`), so changes are tested before release.
- Config format changes: additive within `version: 1`; breaking changes bump `version` with an ADR and a migration note.

## 7. Milestones

| Milestone | Plan phase | Contents | Status |
|---|---|---|---|
| 0 | Kit | Repo, CLAUDE.md, this doc, ADR 0001, config schema | Done 22 Oct 2026 |
| 1 | 0 and 2 | Reusable CI (`verify`), changed-path risk check with label approval, hard rules with `secrets` preset; Ward Intel wired on a branch | In progress |
| 2 | 2 | **[Proposed]** Escalation channel (one place the owner sees approval requests), tier labels on PRs, a bot identity for agents (K3), Dependabot patch-bump exception for lockfiles (K6) | |
| 3 | 1 | **[Proposed]** Preview URL resolver (`previews`), Playwright conventions and helpers, fixed journey suite run against previews; secret exposure per stage | |
| 4 | 1 | **[Proposed]** AI exploratory tester (layer 2) through the model gateway; outputs new Playwright tests | |
| 5 | 3 | **[Proposed]** Intake issue form, triage, build and reviewer agents (coding agent as a swappable CLI step) | |
| 6 | 1 and 4 | **[Proposed]** Read-only production smoke checks, tier-0 auto-ship per project, weekly digest | |

What Ward Intel can't prove (human-facing sign-up, invite emails, per-role permissions) needs extra kit work for Made Impact in milestone 3 (test inbox, synthetic personas, role journeys).

## 8. Changelog

| Date | Change |
|---|---|
| 2026-10-22 | Milestones 0 and 1: repo, schema v1, CLI, reusable CI workflow, composite action, `secrets` preset |
