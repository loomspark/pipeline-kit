# Loomspark pipeline kit

A reusable, vendor-neutral delivery pipeline for Loomspark projects. Each project keeps a small config file in its own repo; the kit provides the workflows, rules engine and (later) agent prompts and test helpers.

**Status:** milestone 1. Reusable CI with three checks: `verify` (the project's own commands), `hard-rules` (things that must never land) and `risk` (changed-path tiers with approval). First user: Ward Intel.

## Adopt it

1. Add `.pipeline/config.yml` (start from [`examples/pipeline.config.yml`](examples/pipeline.config.yml)).
2. Add `.github/workflows/ci.yml`:

   ```yaml
   name: CI
   on:
     pull_request:
       types: [opened, synchronize, reopened, labeled, unlabeled]
     push:
       branches: [main]
   concurrency:
     group: ci-${{ github.event.pull_request.number || github.ref }}
     cancel-in-progress: ${{ github.event_name == 'pull_request' }}
   permissions:
     contents: read
   jobs:
     pipeline:
       uses: loomspark/pipeline-kit/.github/workflows/ci.yml@v0
   ```

3. Create the approval label (default `risk:approved`) in the project repo.

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
