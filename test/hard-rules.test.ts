import { test } from "node:test";
import assert from "node:assert/strict";
import { allHardRules } from "../src/config.ts";
import { checkHardRules } from "../src/hard-rules.ts";
import { exampleConfig, fake } from "./helpers.ts";
import type { Change, Status } from "../src/diff.ts";

function change(entries: Record<string, { status?: Status; lines?: string[] }>): Change {
  return {
    files: Object.entries(entries).map(([path, e]) => ({ path, status: e.status ?? "M" })),
    added: new Map(Object.entries(entries).map(([path, e]) => [path, (e.lines ?? []).map((text, i) => ({ line: i + 1, text }))])),
  };
}

const check = (c: Change) => checkHardRules(c, allHardRules(exampleConfig())).map((f) => `${f.rule.id} ${f.path}${f.line ? ":" + f.line : ""}`);

test("clean change passes", () => {
  assert.deepEqual(check(change({ "src/app.ts": { lines: ["export const x = 1;"] } })), []);
});

test("forbidden files fail when added or modified, not when deleted", () => {
  assert.deepEqual(check(change({ "exports/members.csv": { status: "A" } })), ["no-exports exports/members.csv"]);
  assert.deepEqual(check(change({ "exports/members.csv": { status: "D" } })), []);
});

test("env files are forbidden except .env.example", () => {
  assert.deepEqual(check(change({ ".env.local": { status: "A" }, "apps/web/.env": { status: "A" }, ".env.example": { status: "A" } })), [
    "secrets-env-file .env.local",
    "secrets-env-file apps/web/.env",
  ]);
});

test("credential patterns are caught on added lines, with line numbers", () => {
  const c = change({
    "src/client.ts": { lines: ["const a = 1;", `const key = "${fake.anthropic()}";`] },
    "scripts/deploy.sh": { lines: [`export TOKEN=${fake.github()}`] },
    "infra/key.pem": { lines: [fake.pem()] },
    "config/aws.txt": { lines: [fake.aws()] },
    ".github/workflows/x.yml": { lines: [`url: ${fake.dbUrl()}`] },
  });
  assert.deepEqual(check(c).sort(), [
    "secrets-credential .github/workflows/x.yml:1",
    "secrets-credential config/aws.txt:1",
    "secrets-credential infra/key.pem:1",
    "secrets-credential scripts/deploy.sh:1",
    "secrets-credential src/client.ts:2",
  ]);
});

test("placeholder connection strings are not credentials", () => {
  const lines = ["postgres://user:password@localhost/db", "DATABASE_URL=postgres://USER:${DB_PASSWORD}@host/db", "postgres://localhost/db"];
  assert.deepEqual(check(change({ "docs/setup.md": { lines } })), []);
});

test("pattern rules respect paths, exceptPaths and ignoreCase", () => {
  const c = change({
    "src/page.tsx": { lines: ['<script src="https://TRACKER.example.invalid/t.js">'] },
    "src/vendor/lib.js": { lines: ["tracker.example.invalid"] },
    "docs/analytics.md": { lines: ["We do not use tracker.example.invalid"] },
  });
  assert.deepEqual(check(c), ["no-tracker src/page.tsx:1"]);
});

test("findings never carry the matched text", () => {
  const secret = fake.anthropic();
  const findings = checkHardRules(change({ "a.ts": { lines: [secret] } }), allHardRules(exampleConfig()));
  assert.equal(findings.length, 1);
  assert.ok(!JSON.stringify(findings).includes(secret));
});
