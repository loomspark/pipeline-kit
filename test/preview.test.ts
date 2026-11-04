import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHub } from "../src/github.ts";
import { PreviewError, checkDeployment, previewFromCommand, resolvePreview, waitForDeployment } from "../src/preview.ts";
import { EXAMPLE_YAML, fakeGitHub } from "./helpers.ts";
import { parseConfig } from "../src/config.ts";

const repo = "example-org/example-app";
const sha = "a".repeat(40);
const dep = (id: number, at: string) => ({ id, created_at: at });
const st = (state: string, at: string, url?: string) => ({ state, created_at: at, environment_url: url });

function client(deployments: unknown[], statuses: Record<number, unknown[]>) {
  const gh = fakeGitHub({
    [`GET /repos/${repo}/deployments`]: () => deployments,
    ...Object.fromEntries(Object.entries(statuses).map(([id, s]) => [`GET /repos/${repo}/deployments/${id}/statuses`, () => s])),
  });
  return { gh, github: new GitHub({ token: "t", repo, fetch: gh.fetch }) };
}

test("a successful deployment's URL is returned, for the exact commit and environment", async () => {
  const { gh, github } = client([dep(1, "2026-11-04T10:00:00Z")], { 1: [st("success", "2026-11-04T10:02:00Z", "https://example-app-abc.preview.example.invalid/")] });
  assert.equal(await checkDeployment(github, sha, "Preview"), "https://example-app-abc.preview.example.invalid");
  const q = new URLSearchParams(gh.calls[0].path.split("?")[1]);
  assert.equal(q.get("sha"), sha);
  assert.equal(q.get("environment"), "Preview");
});

test("the newest deployment and its newest status win", async () => {
  const { github } = client(
    [dep(1, "2026-11-04T10:00:00Z"), dep(2, "2026-11-04T11:00:00Z")],
    { 2: [st("success", "2026-11-04T11:02:00Z", "https://new.example.invalid"), st("in_progress", "2026-11-04T11:00:30Z")] },
  );
  assert.equal(await checkDeployment(github, sha, "Preview"), "https://new.example.invalid");
});

test("no deployment yet, or one still building, means wait", async () => {
  assert.equal(await checkDeployment(client([], {}).github, sha, "Preview"), "waiting");
  assert.equal(await checkDeployment(client([dep(1, "t")], { 1: [] }).github, sha, "Preview"), "waiting");
  assert.equal(await checkDeployment(client([dep(1, "t")], { 1: [st("in_progress", "t")] }).github, sha, "Preview"), "waiting");
});

test("a failed deployment fails at once; success without a URL fails too", async () => {
  await assert.rejects(checkDeployment(client([dep(1, "t")], { 1: [st("failure", "t")] }).github, sha, "Preview"), PreviewError);
  await assert.rejects(checkDeployment(client([dep(1, "t")], { 1: [st("error", "t")] }).github, sha, "Preview"), /didn't build/);
  await assert.rejects(checkDeployment(client([dep(1, "t")], { 1: [st("success", "t")] }).github, sha, "Preview"), /no preview URL/);
});

test("waiting polls until ready", async () => {
  let n = 0;
  const gh = fakeGitHub({
    [`GET /repos/${repo}/deployments`]: () => (n++ < 2 ? [] : [dep(1, "t")]),
    [`GET /repos/${repo}/deployments/1/statuses`]: () => [st("success", "t", "https://ready.example.invalid")],
  });
  let clock = 0;
  const url = await waitForDeployment(new GitHub({ token: "t", repo, fetch: gh.fetch }), sha, "Preview", {
    timeoutMs: 60_000,
    intervalMs: 10_000,
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
  });
  assert.equal(url, "https://ready.example.invalid");
  assert.equal(clock, 20_000);
});

test("waiting fails closed after the timeout", async () => {
  let clock = 0;
  await assert.rejects(
    waitForDeployment(client([], {}).github, sha, "Preview", { timeoutMs: 30_000, intervalMs: 10_000, now: () => clock, sleep: async (ms) => void (clock += ms) }),
    /No ready Preview deployment/,
  );
  assert.ok(clock <= 30_000);
});

test("source: command takes the last line, which must be a URL", () => {
  assert.equal(previewFromCommand(`printf 'building\\nhttps://cmd.example.invalid/\\n'`), "https://cmd.example.invalid");
  assert.throws(() => previewFromCommand("echo no url here"), PreviewError);
});

test("no previews resolves to nothing, without calling GitHub", async () => {
  const config = parseConfig(EXAMPLE_YAML + "\npreviews:\n  source: none\n");
  assert.equal(await resolvePreview(config, sha, async () => assert.fail("no GitHub call expected")), undefined);
});
