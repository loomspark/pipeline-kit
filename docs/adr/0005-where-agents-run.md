# ADR 0005: Unattended agents run on a separate machine; kit changes are made on the owner's laptop

**Status:** Accepted · **Date:** 2026-11-05 · **Resolves:** K7 · **Builds on:** ADR 0002, ADR 0003

## Context

On the owner's laptop, an agent session could still reach the owner's own GitHub login, so "agents act only as the agent identity" was a convention there, not a wall (K7). The owner now works across two machines:

- **The laptop:** every repo, environment and the owner's own credentials. Interactive Claude sessions run here, with the owner watching.
- **An always-on machine** (currently a Mac Mini) running Marvin, the owner's autonomous agent. The owner gives it tasks by chat (for example OpenClaw or Telegram) and doesn't watch its screen.

In early use, work moved back and forth between the two: the agent machine didn't have the right checkout, so the owner copied commands between sessions on the two machines. That was hard to follow, and it undercut the point of an unattended agent.

## Decision

1. **Unattended agent work runs on the separate agent machine,** where only the agent identity's key exists. That machine has no personal GitHub login (`gh auth status` shows none, and the keychain holds no GitHub credentials for the owner). This is the "separate machine" option from K7, and it turns "agents act only as the agent" into a wall there.
2. **The owner follows the agent through GitHub, not the agent machine's screen.** The agent opens PRs as the agent, CI sets the risk status, tier 2 asks for the owner's review on their phone, and the agent merges only with `agent merge` (ADR 0003).
3. **Changes to the kit itself are made only from the owner's laptop, never by the unattended agent.** The kit is the set of guardrails the agent runs inside. Letting it edit them is the conflict guardrail 7 forbids, and a kit release changes the gates of every project at once. When the kit blocks the agent, the agent reports what blocked it, and the owner decides on the laptop whether and how to change the kit.
4. **The agent machine uses the kit, but never edits it.** It keeps its own clones of the project repos at fixed paths, plus a kit checkout used only to run the CLI, kept on the current release tag (`v1`) so it matches CI. It holds `~/.config/pipeline-kit/agent.json`, the key file, and the `agent merge` allow rule.
5. **No relaying commands between machines.** If a task seems to need a command copied from one machine's session to the other's, either the task belongs on the laptop (do all of it there), or the agent machine's setup is missing something (fix the setup once).

## Consequences

- K7 is resolved for unattended work. On the laptop, agent sessions can still reach the owner's login. That's accepted because the owner is watching those sessions, and approvals never depended on it (ADR 0002).
- The wall in decision 1 only holds while the agent machine really has no personal login. That's part of the machine's setup, and the owner should check it again whenever the machine is changed.
- Decision 3 is enforced by GitHub, not just a habit, for Marvin's own GitHub App: `marvin-loomspark` is no longer installed on `pipeline-kit` (removed by the owner, 2026-11-05). Two things on the agent machine are still to check (task 1026, the audit of the Mini):
  - **Which identity `~/.config/pipeline-kit/agent.json` points at.** If it holds the key of the laptop's agent app, which is installed on `pipeline-kit`, the agent machine can still push to the kit. Then point it at `marvin-loomspark` and keep the laptop's key on the laptop only.
  - **How its kit checkout gets updated.** If it still needs updates, use a read-only deploy key on `pipeline-kit`.
- ADR 0003 says nothing merges unless an agent session is running. On the always-on machine, that's now normally true. A GitHub-side merge job (milestone 6) is still the route to merging with no agent running.
