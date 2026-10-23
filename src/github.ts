// Minimal GitHub REST client: the few calls the kit makes. Uses the job's GITHUB_TOKEN in
// CI, or an agent identity's installation token (src/agent.ts). Never logs tokens or bodies.

import type { Review } from "./risk.ts";

export type Fetch = typeof fetch;

export interface GitHubOptions {
  token: string;
  repo: string; // owner/name
  api?: string;
  fetch?: Fetch;
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class GitHub {
  readonly repo: string;
  private readonly token: string;
  private readonly api: string;
  private readonly fetch: Fetch;

  constructor(o: GitHubOptions) {
    this.token = o.token;
    this.repo = o.repo;
    this.api = (o.api ?? "https://api.github.com").replace(/\/$/, "");
    this.fetch = o.fetch ?? fetch;
  }

  async request<T>(method: string, path: string, body?: unknown, auth = `Bearer ${this.token}`): Promise<T> {
    const res = await this.fetch(`${this.api}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: auth,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "loomspark-pipeline-kit",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new GitHubError(res.status, `GitHub ${method} ${path.split("?")[0]} failed: HTTP ${res.status}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** All reviews on a PR, oldest first. */
  async reviews(pr: number): Promise<Review[]> {
    const out: Review[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.request<{ user: { login: string } | null; state: string; commit_id: string; html_url: string }[]>(
        "GET",
        `/repos/${this.repo}/pulls/${pr}/reviews?per_page=100&page=${page}`,
      );
      out.push(...batch.filter((r) => r.user).map((r) => ({ user: r.user!.login, state: r.state, commit: r.commit_id, url: r.html_url })));
      if (batch.length < 100) return out;
    }
  }

  async setStatus(sha: string, status: { state: "success" | "failure" | "pending" | "error"; context: string; description: string; target_url?: string }) {
    await this.request("POST", `/repos/${this.repo}/statuses/${sha}`, { ...status, description: status.description.slice(0, 140) });
  }

  async requestReviewers(pr: number, reviewers: string[]) {
    if (reviewers.length) await this.request("POST", `/repos/${this.repo}/pulls/${pr}/requested_reviewers`, { reviewers });
  }

  /** Create or update the one comment carrying `marker`. */
  async upsertComment(pr: number, marker: string, body: string) {
    const text = `${marker}\n${body}`;
    for (let page = 1; ; page++) {
      const batch = await this.request<{ id: number; body?: string; user: { type: string } | null }[]>(
        "GET",
        `/repos/${this.repo}/issues/${pr}/comments?per_page=100&page=${page}`,
      );
      const mine = batch.find((c) => c.user?.type === "Bot" && c.body?.startsWith(marker));
      if (mine) {
        if (mine.body !== text) await this.request("PATCH", `/repos/${this.repo}/issues/comments/${mine.id}`, { body: text });
        return;
      }
      if (batch.length < 100) break;
    }
    await this.request("POST", `/repos/${this.repo}/issues/${pr}/comments`, { body: text });
  }
}
