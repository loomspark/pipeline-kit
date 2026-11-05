# ADR 0005: Ops notices through one Telegram bot, one topic per repo

**Status:** Accepted · **Date:** 2026-11-05

## Context

The owner wants one easy place to see how each Loomspark repo's jobs are doing (Ward Intel's daily collection first), without a flood of messages. Ward Intel's privacy rules forbid any user content in logs or outward messages, so the channel must make leaking content hard, not just discouraged.

## Decision

1. **One bot, one private Telegram group with Topics, one topic per repo** (`message_thread_id`). Every repo uses the same token and chat ID and its own `TELEGRAM_TOPIC_ID`. No bot per repo.
2. **Two levels chosen in code:** `alert` (sound) for things needing action today; `digest` (`disable_notification`) for one quiet daily summary per repo. Everything else stays in the repo's own database, admin and logs; messages link there.
3. **Structured notices only:** a fixed title, labelled facts (number, boolean, or a short single-line string) and https links. No free-text body; strings capped at 80 characters. Callers may pass counts, statuses, names and links only, never user content or anything derived from it.
4. **Never fail the caller:** `notify` returns a result and never throws; unset config is a quiet no-op; errors carry Telegram's description or the error's name only, never the token or the request URL.
5. **Distribution by vendoring:** `src/notify.ts` has no imports, so a project copies that one file (with the kit commit in a header). The kit is private (K1, K2), so projects can't install it as a package on their hosts. Shell and CI steps use `pipeline-kit notify`.
6. **IDs without sharing the token:** `pipeline-kit notify --discover` lists groups and topics the bot has seen, IDs and names only, run by the owner with the token in their own environment.

## Consequences

- One group to mute or unmute; per-repo topics keep it readable. Adding a repo is one topic and three env vars.
- Vendored copies can drift from the kit. Acceptable for a small, stable file; a test keeps `notify.ts` import-free so copying stays possible. Revisit if the kit becomes an installable package.
- Kit CI alerts (main build broken, tier-2 PR waiting) can use the CLI later; not wired in this change.
- Telegram holds the messages. They contain only counts, statuses, names and links, so that is acceptable; nothing else may be sent.
