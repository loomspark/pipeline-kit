import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLE_YAML, fake } from "./helpers.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");
let repo: string;

function git(...args: string[]) {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function write(path: string, text: string) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function kit(args: string[], env: Record<string, string> = {}) {
  const summary = join(repo, "..", `summary-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(summary, "");
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: summary, ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr, summary: readFileSync(summary, "utf8") };
}

before(() => {
  repo = join(mkdtempSync(join(tmpdir(), "kit-cli-")), "repo");
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Kit Test");
  write(".pipeline/config.yml", EXAMPLE_YAML);
  write("src/app.ts", "export const greeting = 'hello';\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feature");
});

after(() => rmSync(dirname(repo), { recursive: true, force: true }));

test("validate and plan", () => {
  const v = kit(["validate"]);
  assert.equal(v.code, 0, v.err);
  assert.match(v.out, /valid \(1 verify commands, 3 risk rules, 4 hard rules\)/);
  const p = kit(["plan"]);
  assert.equal(p.code, 0, p.err);
  assert.deepEqual(JSON.parse(p.out).commands, [{ name: "test", run: "npm test" }]);
});

test("docs change: tier 0, no approval needed, hard rules pass", () => {
  write("docs/guide.md", "# Guide\n");
  git("add", ".");
  git("commit", "-q", "-m", "docs");
  const r = kit(["risk", "--base", "main"], { KIT_EVENT_ACTION: "opened" });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.summary, /Risk: tier 0 \(auto-ship\)/);
  assert.equal(kit(["hard-rules", "--base", "main"]).code, 0);
});

test("migration: tier 2 fails until the approval label is applied", () => {
  write("db/migrations/0002_add_table.sql", "create table example (id int);\n");
  git("add", ".");
  git("commit", "-q", "-m", "migration");
  const needed = kit(["risk", "--base", "main"], { KIT_EVENT_ACTION: "synchronize", KIT_PR_LABELS: "[]" });
  assert.equal(needed.code, 1);
  assert.match(needed.out, /::error title=risk::Tier 2/);
  const approved = kit(["risk", "--base", "main"], { KIT_EVENT_ACTION: "labeled", KIT_EVENT_LABEL: "risk:approved", KIT_EVENT_ACTOR: "example-owner", KIT_PR_LABELS: '["risk:approved"]' });
  assert.equal(approved.code, 0, approved.out);
  assert.match(approved.summary, /Approved by @example-owner/);
});

test("a committed secret fails hard rules and is never printed", () => {
  const secret = fake.anthropic();
  write("src/client.ts", `export const key = "${secret}";\n`);
  git("add", ".");
  git("commit", "-q", "-m", "oops");
  const r = kit(["hard-rules", "--base", "main"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /::error file=src\/client.ts,line=1,title=hard rule secrets-credential::/);
  for (const stream of [r.out, r.err, r.summary]) assert.ok(!stream.includes(secret));
});

test("new-branch pushes with no base skip hard rules", () => {
  const r = kit(["hard-rules", "--base", "0000000000000000000000000000000000000000"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /skipped/);
});

test("missing config is a clear error", () => {
  const r = kit(["validate", "--config", "nope.yml"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /No pipeline config at nope.yml/);
});
