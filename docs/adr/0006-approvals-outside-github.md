# ADR 0006: Approvals outside GitHub, in two lanes, with rollback

**Status:** Proposed · **Date:** 2026-11-11 · **Would amend:** ADR 0002 (approval method), ADR 0003 (merging)

## Context

ADR 0002 made approval a listed approver's GitHub review on the PR's exact head commit. That suits the owner, who lives in GitHub. When Made Impact adopts the kit, the people approving changes won't: they won't open GitHub to review a PR. They live in a messaging app (WhatsApp is the likely one; Telegram or email elsewhere) and in their own organisation's admin tool.

ADR 0002 rejected "approve in chat and let the agent apply the label", because the approval would rest on an agent relaying it honestly. That reason stands. It also listed a "custom approval service (web page or bot with an approve button)" as possible later. This ADR proposes that service.

The owner's experience also shapes it. For a small change they shaped in conversation, by the time it reaches approval they already know what it is, and a one-tap "yes" is right. For a big change, or one they weren't part of, they need to look properly first. People shouldn't have to make that call each time; the pipeline should make it for them, from facts it already has.

## Decision (proposed)

### 1. An approval service that isn't an agent

A small always-on service (a serverless function or similar; any host) receives approvals. It acts as its own **approver GitHub App**, separate from the agent app. Agents never hold its key or its channel credentials, so an agent still can't approve its own work (guardrail 7).

When it accepts an approval, it records who, how, when and for which commit, sets the `pipeline-kit/risk` status itself, and posts a line on the PR such as "Approved by *name* via chat, 14:02, commit `abc1234`". GitHub stays the record of what changed. The service's audit log becomes the record of who approved, linked from the PR.

The risk check gains a third method, `risk.approval.method: service`. It counts an approval only when the approver app set it for the current head commit. Anything else fails closed, as now.

### 2. Two lanes, chosen by the pipeline

| | Fast lane | Full lane |
|---|---|---|
| When | Tier 1 **and** the approver was involved in the change | Tier 2, or any change the approver wasn't involved in |
| Chat message | One-line summary, **Approve** button, "See details" link | "A change needs your review" and a link. **No approve button** |
| Where approval happens | In the chat, or on the page | On the page only |
| Identity | The channel's sender identity (phone number, chat user ID) | Signed-in session in the admin tool **plus a passkey check** (Face ID or fingerprint on a phone) |

"Involved" means the approver raised the request or took part in the conversation that shaped it (the intake issue in milestone 5). Until there's a reliable signal for that, everything uses the full lane (K9).

A change can never move to a lighter lane than its tier allows. Changes to `.pipeline/**` and `.github/workflows/**` stay GitHub-review-only, so a chat approver can never loosen the rules.

### 3. The page lives in the organisation's own admin tool

People are already signed in there, and it already knows their roles. The kit doesn't host the page. It defines:

- **An approval request record** (a JSON contract, schema in the kit): plain-English summary, tier and why, before-and-after screenshots from the journeys run on the preview, the preview link, head commit, approvers asked, lane, expiry.
- **An endpoint** the page calls to approve, reject or roll back, signed by the person's session.
- **A reference page or component** a project can copy to get started.

The project renders the record in its admin tool. That keeps the kit vendor-neutral and the page in the right place.

### 4. Links and messages

- **Links are signed, short-lived, single-use, and tied to one person and one commit.** Opening a link never approves anything. Only pressing the button on the page does. This also stops email and chat link scanners, which open links automatically, from approving by accident.
- **Any push after the request** invalidates its link and button. The approvers get a fresh message. This is the same "stale" rule as ADR 0002.
- **Messages carry no user content**, following ADR 0005: fixed text, the change's title, counts, names and links. The detail is behind the link, where sign-in protects it.
- **Channel adapters** sit behind one interface: WhatsApp (Business Platform), Telegram and email to start. None is required. A project picks which ones in config, naming secrets only.

### 5. Approval leads to a deploy without anyone opening a session

Once approved, the unattended merge job (milestone 6, ADR 0003) merges with the same guards as `agent merge`. Without it, an approval waits for an agent session, which other people can't start. So this lane depends on milestone 6.

### 6. Rollback

Two separate actions, both on the page and offered in a "now live" message after each deploy:

1. **Restore the previous version now.** This runs the project's `rollback` command from config (vendor-neutral: most hosts can switch back to an earlier deploy in seconds). It's for "it's broken now". Anyone who could approve the change can do it, after a passkey check for tier-2 changes.
2. **Remove the change.** The service opens a revert PR. If the PR is an exact reversal of a change the same person approved, it counts as approved by them. Otherwise it goes through the normal lanes.

**Database changes don't roll back like code.** Restoring an earlier deploy leaves the database as the newer code left it. So migrations stay tier 2, and the approval request must say plainly whether the change can be undone (K11).

## Alternatives considered

- **Approve in chat and let an agent relay it.** Rejected again for the ADR 0002 reason: the approval would rest on the agent's word.
- **One lane: always the page.** Simpler and stronger, but it makes people work through detail they already know for small changes, so they'd stop looking at the page properly. Two lanes keep the careful look for when it counts.
- **One lane: always the chat button.** Rejected: a phone number alone isn't enough to put a risky change live.
- **A page hosted by the kit instead of in each admin tool.** Less work per project, but one more place to sign in, with no knowledge of the organisation's roles. Kept as a fallback for projects with no admin tool.
- **SMS codes for the second factor.** Weaker than passkeys (SIM swap) and slower on a phone.

## Consequences

- People who don't use GitHub can approve and roll back changes. Each approval is still tied to an exact commit and a named person.
- The trust anchor for these approvals moves from GitHub's review record to the approval service and its audit log. The service and its keys become as sensitive as a GitHub approver's account.
- K4 (checks not enforceable on GitHub Free) matters more: with other people and an unattended merge job, the risk status should physically block a merge.
- The kit gains a running service for the first time, so it needs hosting, uptime and secret storage (K8). That ties in with K7: no agent session may reach the approver app's key.
- WhatsApp needs a verified Meta business account and pre-approved message templates (K10).
- Depends on milestones 3 (screenshots from journeys), 5 (involvement signal, eventually) and 6 (unattended merge).
