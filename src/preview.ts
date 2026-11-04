// Preview URL resolver (milestone 3). The kit never assumes a host: a preview is a URL,
// read from the GitHub deployment status the host posts for the exact commit, or printed
// by a project command. Fails closed: no ready preview within the timeout is a failure,
// never a skip, so a journey check can't pass without having run.

import { execSync } from "node:child_process";
import type { GitHub } from "./github.ts";
import type { PipelineConfig } from "./types.ts";

export interface WaitOptions {
  timeoutMs: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

interface Deployment {
  id: number;
  created_at: string;
}

interface DeploymentStatus {
  state: string;
  environment_url?: string;
  created_at: string;
}

export class PreviewError extends Error {}

/** One look: the URL if ready, "waiting" if not yet, or throws if the host reported a failure. */
export async function checkDeployment(github: GitHub, sha: string, environment: string): Promise<string | "waiting"> {
  const q = new URLSearchParams({ sha, environment, per_page: "10" });
  const deployments = await github.request<Deployment[]>("GET", `/repos/${github.repo}/deployments?${q}`);
  if (!deployments.length) return "waiting";
  // The newest deployment for this commit wins (a redeploy replaces an earlier one).
  const latest = [...deployments].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const statuses = await github.request<DeploymentStatus[]>("GET", `/repos/${github.repo}/deployments/${latest.id}/statuses?per_page=10`);
  const status = [...statuses].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!status) return "waiting";
  if (status.state === "success") {
    if (!status.environment_url || !/^https?:\/\//.test(status.environment_url)) {
      throw new PreviewError(`The ${environment} deployment for ${sha.slice(0, 7)} succeeded but posted no preview URL.`);
    }
    return status.environment_url.replace(/\/$/, "");
  }
  if (status.state === "failure" || status.state === "error" || status.state === "inactive") {
    throw new PreviewError(`The ${environment} deployment for ${sha.slice(0, 7)} reported "${status.state}": the preview didn't build.`);
  }
  return "waiting"; // queued, pending, in_progress
}

/** Wait for the deployment status of `sha` in `environment` to report a ready URL. */
export async function waitForDeployment(github: GitHub, sha: string, environment: string, o: WaitOptions): Promise<string> {
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const interval = o.intervalMs ?? 10_000;
  const deadline = now() + o.timeoutMs;
  let waited = false;
  for (;;) {
    const result = await checkDeployment(github, sha, environment);
    if (result !== "waiting") return result;
    if (now() + interval > deadline) {
      throw new PreviewError(`No ready ${environment} deployment for ${sha.slice(0, 7)} after ${Math.round(o.timeoutMs / 60_000)} min. Is the host deploying this branch?`);
    }
    if (!waited) o.log?.(`Waiting for the ${environment} deployment of ${sha.slice(0, 7)}...`);
    waited = true;
    await sleep(interval);
  }
}

/** source: command. The last non-empty line the command prints must be the URL. */
export function previewFromCommand(command: string, env: NodeJS.ProcessEnv = process.env): string {
  const out = execSync(command, { encoding: "utf8", env, stdio: ["ignore", "pipe", "inherit"] });
  const last = out.trim().split("\n").at(-1)?.trim() ?? "";
  if (!/^https?:\/\/\S+$/.test(last)) throw new PreviewError("The previews command didn't print a URL as its last line.");
  return last.replace(/\/$/, "");
}

/** The preview URL for `sha`, or undefined when the project has no previews. */
export async function resolvePreview(config: PipelineConfig, sha: string, github: () => Promise<GitHub>, o: Omit<WaitOptions, "timeoutMs"> = {}): Promise<string | undefined> {
  const p = config.previews;
  if (!p || p.source === "none") return undefined;
  if (p.source === "command") return previewFromCommand(p.command!, { ...process.env, KIT_HEAD_SHA: sha });
  return waitForDeployment(await github(), sha, p.environment!, { ...o, timeoutMs: p.timeoutMinutes * 60_000 });
}
