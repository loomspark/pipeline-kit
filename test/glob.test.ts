import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesAny } from "../src/glob.ts";

const cases: [string, string, boolean][] = [
  ["**", ".env", true],
  ["**", ".github/workflows/ci.yml", true],
  ["**/.env", ".env", true],
  ["**/.env", "apps/web/.env", true],
  ["**/.env.*", "apps/web/.env.local", true],
  ["**/*.ts", ".github/scripts/x.ts", true],
  ["**/*.ts", "x.ts", true],
  ["*.md", "README.md", true],
  ["*.md", "docs/README.md", false],
  ["**/*.md", "docs/README.md", true],
  ["db/migrations/**", "db/migrations/0001_init.sql", true],
  ["db/migrations/**", "db/migrations/nested/x.sql", true],
  ["db/migrations/**", "db/migrations-old/x.sql", false],
  ["src/*.ts", "src/a/b.ts", false],
  ["src/**/*.test.ts", "src/a.test.ts", true],
  ["src/**/*.test.ts", "src/lib/deep/a.test.ts", true],
  ["{package.json,package-lock.json}", "package-lock.json", true],
  ["{package.json,package-lock.json}", "package.jsonx", false],
  ["file?.txt", "file1.txt", true],
  ["file?.txt", "file/.txt", false],
  ["[ab].txt", "a.txt", true],
  ["[!ab].txt", "a.txt", false],
  ["a.b", "axb", false],
  ["(x)+", "(x)+", true],
];

for (const [glob, path, expected] of cases) {
  test(`${glob} ${expected ? "matches" : "does not match"} ${path}`, () => {
    assert.equal(matchesAny(path, [glob]), expected);
  });
}

test("unclosed brace is an error", () => {
  assert.throws(() => matchesAny("x", ["{a,b"]), /Unclosed/);
});
