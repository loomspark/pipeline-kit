# Loomspark pipeline kit

**New here? Start with [How a change gets merged](docs/how-it-works.md):** a plain-English guide with a diagram, written for reading on a phone.

A reusable, vendor-neutral delivery pipeline for Loomspark projects. Each project keeps a small config file in its own repo; the kit provides the workflows, rules engine and (later) agent prompts and test helpers.

**Status:** milestone 2 (`v1`). Reusable CI with three checks: `verify` (the project's own commands), `hard-rules` (things that must never land) and `risk` (changed-path tiers; risky changes need a listed person's GitHub review, requested automatically so it reaches their phone). Agents act as their own GitHub App identity ([setup](docs/agent-identity.md)). First user: Ward Intel.

## Adopt it

1. Add `.pipeline/config.yml` (start from [`examples/pipeline.config.yml`](examples/pipeline.config.yml)).
2. Add `.github/workflows/ci.yml`:

   ```yaml
   name: CI
   on:
     pull_request:
       types: [opened, synchronize, reopened, labeled, unlabeled]
     pull_request_review:
       types: [submitted, dismissed]
     push:
       branches: [main]
   concurrency:
     group: ci-${{ github.event.pull_request.number || github.ref }}
     cancel-in-progress: ${{ github.event_name == 'pull_request' }}
   permissions:
     contents: read
     pull-requests: write # review requests and the risk comment
     statuses: write # the pipeline-kit/risk status
   jobs:
     pipeline:
       uses: loomspark/pipeline-kit/.github/workflows/ci.yml@v1
   ```

3. Set `risk.approval` in the config: `method: review` with `approvers: [your-login]` once the agent identity exists, otherwise the `label` method (create the `risk:approved` label).

Details, semantics and the roadmap: [`docs/design.md`](docs/design.md). Why it's shaped this way: [`docs/adr/0001-kit-shape.md`](docs/adr/0001-kit-shape.md).

## Develop

```bash
npm ci
npm test
npm run typecheck
npm run kit -- risk --base origin/main
```

## Licence

Not yet decided (see [open question K1](docs/open-questions.md)). Until then, all rights reserved by Loomspark.
