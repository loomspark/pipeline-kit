# Agent identity and approvals

Why: [ADR 0002](adr/0002-agent-identity-and-review-approval.md). In short, agents act on GitHub as their own identity (a GitHub App), never as a person. Risky changes are approved by a listed person's GitHub review, which GitHub records against that person and that exact commit. Nothing an agent says or does can produce an approval that counts.

## What each identity can do

| | Owner (a person) | Agent identity (GitHub App) | CI (`GITHUB_TOKEN`) |
|---|---|---|---|
| Push branches, open PRs, comment | yes | yes | comments only |
| Change `.github/workflows/**` | yes | **no** (no `workflows` permission) | no |
| Approve a risky change | **yes** (listed in `approval.approvers`) | no: it can submit a review, but only listed approvers' reviews count | no |
| Merge | yes | yes, only when every check is green (agent rules) | no |
| Repo settings, secrets | yes | no | no |

## One-time setup (owner, about 10 minutes)

### 1. Create the GitHub App

1. Open <https://github.com/settings/apps/new> (signed in as the account that owns the repos).
2. **GitHub App name:** `Loomspark Agent`. Names are global; if taken, add something, e.g. `Loomspark Agent RS`.
3. **Homepage URL:** `https://github.com/loomspark`.
4. **Webhook:** untick **Active**. Leave the URL empty.
5. **Repository permissions.** Set these and leave everything else as **No access**:
   - **Contents:** Read and write
   - **Pull requests:** Read and write
   - **Actions:** Read-only
   - **Checks:** Read-only
   - **Commit statuses:** Read-only
   - **Metadata:** Read-only (set automatically)

   Do **not** grant Workflows, Administration, Secrets or Environments. Without Workflows, agents can't change CI.
6. **Where can this GitHub App be installed?** Only on this account.
7. **Create GitHub App.** On the next page, note the **App ID** (a number). It isn't secret.

### 2. Make its key

1. On the same page, scroll to **Private keys** and click **Generate a private key**. A `.pem` file downloads.
2. Move it somewhere only you and the agent tooling read, outside any repo. In Terminal:

   ```bash
   mkdir -p ~/.config/pipeline-kit && mv ~/Downloads/loomspark-agent*.private-key.pem ~/.config/pipeline-kit/agent-key.pem && chmod 600 ~/.config/pipeline-kit/agent-key.pem
   ```

   This key *is* the agent's identity: never commit it, paste it into chat, or put it in a config file. If it leaks, delete it on the app's page and generate a new one.

### 3. Install it on the repos

1. In the app's settings, left menu: **Install App**, then **Install** next to your account.
2. Choose **Only select repositories** and pick the repos agents work in (e.g. `wardintel`, `pipeline-kit`).

### 4. Tell the agent tooling the App ID

Give Claude the App ID (or write the file yourself):

```json
// ~/.config/pipeline-kit/agent.json
{ "appId": "123456", "keyFile": "~/.config/pipeline-kit/agent-key.pem" }
```

### 5. Get approvals on your phone

Install the **GitHub** mobile app and sign in. Under **Settings → Notifications**, keep **Review requests** on. When a risky change needs you, the risk check requests your review and the app notifies you. Open it, read the agent's summary at the top of the PR, and tap **Approve** (in the PR: **Files changed → Review changes → Approve**).

## How agents use it

From any checkout of a repo the app is installed on:

```bash
npm run --prefix <kit> kit -- agent git push -u origin my-branch
npm run --prefix <kit> kit -- agent gh pr create --title "..." --body "..."
npm run --prefix <kit> kit -- agent git commit -m "..."
```

Each call mints a one-hour token scoped to that one repo and runs the command with it. Commits are authored as `<app-slug>[bot]`. The token goes to `gh` as `GH_TOKEN` and to `git` as an auth header through environment variables, never in arguments or output. Stored credentials (the macOS keychain, your `gh` login) are switched off for that command, so it can't fall back to acting as you.

## Limits

- **On the owner's own laptop, this is a convention, not a wall.** An agent session there could still reach the owner's `gh` login. The approval check doesn't depend on it: GitHub records who reviewed, and only listed people's reviews count. But the agent could, in principle, act as the owner elsewhere. The wall comes from running agent sessions where only the agent's key exists (a cloud runner or a separate machine user). See open question K7.
- **GitHub Free can't make the risk status required** on private repos (K4). Agents don't merge while it's failing; people can still press the button.
