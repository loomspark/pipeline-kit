# ADR 0004: Journeys run against each PR's preview, and stages get only the secrets they're granted

**Status:** Proposed · **Date:** 2026-11-04 · **Builds on:** ADR 0001, ADR 0003

## Context

Milestone 3 makes an end-to-end test the gate for agent-built changes: a browser journey runs against the preview of every PR, and a failure stops the merge. Previews are built by the project's host, not by CI, and may sit behind the host's login. GitHub Free can't make checks required on private repos (K4), so the gate is `agent merge`, which needs every check green (ADR 0003).

## Decision

1. **A `journeys` job in the reusable workflow**, on PRs only. It finds the preview of the PR's head commit, waits for it to be ready (`previews.timeoutMinutes`, default 10), installs the project and Chromium, and runs the project's Playwright specs listed under `journeys`. A preview that fails to build, never appears, or a listed journey with no spec, fails the job. It never skips while journeys are listed.
2. **Previews are a URL.** `source: deployment` reads the GitHub deployment status the host posts for that exact commit and environment (the caller grants `deployments: read`); `source: command` runs a project command that prints it. No host is named in the kit.
3. **Projects own their journeys; the kit owns finding the preview and running them.** The contract with the project's Playwright config is two environment variables: `PIPELINE_PREVIEW_URL` and `PIPELINE_PREVIEW_HEADERS`.
4. **Per-stage secrets.** The caller passes its secrets with `secrets: inherit`. The kit hands the journeys run only those listed under `secrets.journeys`, and drops the job's GitHub token. `previews.headers` maps an HTTP header (for example a host's protection bypass) to the name of a granted secret. The config check rejects a header whose secret isn't granted. Granting a secret is a `.pipeline/**` change, so it is tier 2.
5. **Secrets stay out of artifacts.** GitHub masks secrets in logs, not in uploaded files, so the kit uploads no traces, videos or reports, and projects keep them off while headers carry secrets.

## Consequences

- One job, `pipeline / journeys`, joins the checks `agent merge` waits for. It runs on every `pull_request` event, labels included: a cancelled run makes `agent merge` refuse until a later run passes, so cancellation can't open the gate.
- A PR waits for the host's preview build before its journeys finish, typically a few minutes.
- Reusable-workflow changes can't be tested before release by the kit's own CI (it doesn't call `ci.yml`). The first real run is on a project PR after the release; the owner keeps the previous tag to roll `v1` back to.
- Projects that list no journeys see the job pass with nothing to do.
