// Agent identity (ADR 0002). Agents act on GitHub as a GitHub App ("the agent identity"),
// never as a person, so GitHub's own records show who did what and an agent can't
// produce an approval that counts. This module mints a short-lived installation token
// from the app's private key and runs git or gh with it.
//
// The token and key never reach stdout, stderr or process arguments: gh gets GH_TOKEN,
// git gets an auth header through GIT_CONFIG_* environment variables, and both have any
// stored credentials switched off so a command can't silently fall back to a person's login.

import { createSign } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GitHub } from "./github.ts";
import type { Fetch } from "./github.ts";

export const AGENT_CONFIG_FILE = join(homedir(), ".config", "pipeline-kit", "agent.json");

export interface AgentConfig {
  appId: string;
  /** Path to the app's private key (.pem). Stays on the machine that runs agents. */
  keyFile: string;
}

export function loadAgentConfig(env = process.env, file = AGENT_CONFIG_FILE): AgentConfig {
  let fromFile: Partial<AgentConfig> = {};
  if (existsSync(file)) fromFile = JSON.parse(readFileSync(file, "utf8"));
  const appId = env.KIT_AGENT_APP_ID ?? fromFile.appId;
  const keyFile = (env.KIT_AGENT_KEY_FILE ?? fromFile.keyFile)?.replace(/^~(?=\/)/, homedir());
  if (!appId || !keyFile) {
    throw new Error(`Agent identity not set up: need appId and keyFile in ${file} (or KIT_AGENT_APP_ID and KIT_AGENT_KEY_FILE). See docs/agent-identity.md.`);
  }
  return { appId: String(appId), keyFile };
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** App JWT (RS256), valid ~9 minutes, backdated a minute for clock drift. */
export function appJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKeyPem);
  return `${header}.${payload}.${b64url(signature)}`;
}

export interface AgentSession {
  token: string;
  name: string; // e.g. loomspark-agent[bot]
  email: string; // GitHub noreply address, so commits link to the bot account
}

/** Token scoped to one repo, plus the identity to commit as. */
export async function agentSession(repo: string, config: AgentConfig, fetchImpl?: Fetch): Promise<AgentSession> {
  const jwt = appJwt(config.appId, readFileSync(config.keyFile, "utf8"));
  const gh = new GitHub({ token: "", repo, fetch: fetchImpl });
  const auth = `Bearer ${jwt}`;
  const app = await gh.request<{ slug: string }>("GET", "/app", undefined, auth);
  const installation = await gh.request<{ id: number }>("GET", `/repos/${repo}/installation`, undefined, auth);
  const { token } = await gh.request<{ token: string }>(
    "POST",
    `/app/installations/${installation.id}/access_tokens`,
    { repositories: [repo.split("/")[1]] },
    auth,
  );
  const name = `${app.slug}[bot]`;
  const user = await new GitHub({ token, repo, fetch: fetchImpl }).request<{ id: number }>("GET", `/users/${encodeURIComponent(name)}`);
  return { token, name, email: `${user.id}+${name}@users.noreply.github.com` };
}

/** owner/name from the current checkout's origin remote. */
export function originRepo(cwd = process.cwd()): string {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" }).trim();
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error("origin is not a GitHub repository");
  return m[1];
}

/** Environment for git/gh acting as the agent. Exported for tests. */
export function agentEnv(session: AgentSession, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${session.token}`).toString("base64");
  return {
    ...base,
    GH_TOKEN: session.token,
    GITHUB_TOKEN: session.token,
    GH_PROMPT_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: session.name,
    GIT_AUTHOR_EMAIL: session.email,
    GIT_COMMITTER_NAME: session.name,
    GIT_COMMITTER_EMAIL: session.email,
    // Empty credential.helper clears inherited helpers (e.g. the macOS keychain), so git
    // can only authenticate as the agent.
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${basic}`,
  };
}

/** Run git or gh as the agent identity; returns the exit code. */
export async function runAsAgent(tool: "git" | "gh", args: string[]): Promise<number> {
  const session = await agentSession(originRepo(), loadAgentConfig());
  const r = spawnSync(tool, args, { stdio: "inherit", env: agentEnv(session) });
  return r.status ?? 1;
}
