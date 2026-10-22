import { parseConfig } from "../src/config.ts";
import type { PipelineConfig } from "../src/types.ts";
import type { Fetch } from "../src/github.ts";

// A fictional project used across tests. No real project's data belongs in kit tests.
export const EXAMPLE_YAML = `
version: 1
project:
  name: example-app
verify:
  commands:
    - name: test
      run: npm test
risk:
  rules:
    - tier: 2
      paths: ["db/migrations/**", ".github/workflows/**", ".pipeline/**"]
      reason: Schema, CI or pipeline config
    - tier: 2
      paths: ["src/auth/**"]
      reason: Sign-in and sessions
      ref: FR-AUTH-1
    - tier: 0
      paths: ["docs/**", "**/*.md"]
      reason: Documentation
hardRules:
  presets: [secrets]
  rules:
    - id: no-exports
      description: Data exports must never be committed.
      paths: ["exports/**"]
      forbidFile: true
    - id: no-tracker
      description: No third-party trackers.
      ref: FR-ANALYTICS-1
      paths: ["src/**"]
      exceptPaths: ["src/vendor/**"]
      forbidPatterns: ["tracker\\\\.example\\\\.invalid"]
      ignoreCase: true
`;

export function exampleConfig(): PipelineConfig {
  return parseConfig(EXAMPLE_YAML, "example.yml");
}

/** Credential-shaped strings, assembled at runtime so no source file contains one. */
export const fake = {
  anthropic: () => ["sk", "ant", "api03", "x".repeat(40)].join("-"),
  github: () => "gh" + "p_" + "A".repeat(36),
  aws: () => "AK" + "IA" + "B".repeat(16),
  pem: () => "-----BEGIN " + "RSA PRIVATE KEY-----",
  dbUrl: () => "postgres" + "://app_user:" + "s3cretvalue" + "@db.example.invalid/app",
};

export interface Call {
  method: string;
  path: string;
  body?: any;
  auth?: string;
}

/** A fake GitHub: routes "METHOD /path" (query stripped) to canned responses. */
export function fakeGitHub(routes: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = [];
  const fetchImpl: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: (init?.headers as Record<string, string>)?.Authorization,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${url.pathname}`];
    if (!handler) return new Response("not found", { status: 404 });
    const out = handler(call);
    return out === undefined ? new Response(null, { status: 204 }) : Response.json(out);
  };
  return { calls, fetch: fetchImpl };
}

