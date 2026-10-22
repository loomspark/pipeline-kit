# Pipeline kit: working agreements

Reusable, vendor-neutral AI delivery pipeline for Loomspark projects. First used by Ward Intel; Made Impact adopts it later. Read `docs/design.md` first.

## Documentation is part of the work

- Keep `docs/design.md` accurate in the same change as any code, schema or workflow that affects it.
- Record significant decisions as ADRs in `docs/adr/` (`NNNN-short-title.md`). Don't edit an accepted ADR's decision; supersede it.
- Log undecided points in `docs/open-questions.md` (ids `K1`, `K2`...) rather than guessing; mark unconfirmed plans **[Proposed]**.
- The config schema (`schema/pipeline-config.schema.json`) is a contract with every project. Additive changes are fine; a breaking change bumps `version` and needs an ADR.

## Fixed guardrails

These are not defaults to trade off.

1. **Vendor-neutral.** No step may require one AI vendor, one model, one coding agent or one host. Models are reached through an OpenAI-compatible gateway URL from config; the coding agent is a CLI step; previews are "a URL", found from a GitHub deployment status or a command. Vendor names may appear only as examples or as one option among several.
2. **Config names secrets, never holds them.** Values live in each project's GitHub Actions secrets or host secret store. The kit rejects a config that contains anything credential-shaped.
3. **No project data in the kit.** No real content from any project (for example Ward Intel's residents' posts) in code, fixtures, tests, docs, examples or logs. Fixtures are fictional and built in test code; credential-shaped test strings are assembled at runtime so no file contains one.
4. **Never print what a rule matched.** Hard-rule findings report rule, file and line only. Matched text can be a secret or someone's personal data, and CI logs are not a safe place for either.
5. **Fail closed.** When a check can't tell whether something is safe (unknown config key, approval it can't tie to the current head), it fails.
6. **No production credentials in the pipeline.** Agents and CI get staging or test credentials only.
7. **Agents never approve.** An agent must not apply the approval label, approve a PR, or edit risk rules to lower its own change's tier. Changes to `.pipeline/**` are always tier 2.

## Stack and commands

TypeScript run directly by Node's type stripping (Node >= 22.18; CI uses 24), no build step. Only erasable TypeScript syntax (no enums, namespaces or parameter properties). Imports use `.ts` extensions.

- `npm test`: Node test runner over `test/**/*.test.ts`
- `npm run typecheck`
- `npm run kit -- <command>`: run the CLI locally (`validate`, `plan`, `hard-rules`, `risk`)

## Releases

Projects call `loomspark/pipeline-kit/.github/workflows/ci.yml@v0`, and that workflow uses the action at `@v0`. Releasing is: tag `v0.x.y`, then move `v0` to it. See `docs/design.md#versioning`.

## Commits

Small, focused commits. Update docs in the same commit as the change.
