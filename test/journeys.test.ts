import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { ConfigError, JOURNEY_SECRET_SLOTS, parseConfig } from "../src/config.ts";
import { JourneyError, journeyEnv, journeySpecs, journeysSummary, previewHeaders, runJourneys, stageSecrets } from "../src/journeys.ts";
import { EXAMPLE_YAML } from "./helpers.ts";

// Fictional names and values only. Secret-like values are plain words: they stand in for
// what GitHub would pass, and never match the credential patterns.
const WITH_JOURNEYS = `${EXAMPLE_YAML}
previews:
  source: deployment
  environment: Preview
  headers:
    x-preview-bypass: PREVIEW_BYPASS_SECRET
journeys:
  - id: browse-sample
    description: A visitor opens the fictional sample and moves between its pages.
    spec: e2e/browse-sample.spec.ts
secrets:
  verify: []
  journeys: [PREVIEW_BYPASS_SECRET]
  build: [OTHER_STAGE_KEY]
`;

const config = () => parseConfig(WITH_JOURNEYS, "example.yml");
const received = JSON.stringify({ PREVIEW_BYPASS_SECRET: "bypass-value", OTHER_STAGE_KEY: "other-value", github_token: "job-token" });

test("journeys come from the config, in order", () => {
  assert.deepEqual(journeySpecs(config()), ["e2e/browse-sample.spec.ts"]);
});

test("a listed journey with no spec fails the run instead of being skipped", () => {
  const c = config();
  c.journeys!.push({ id: "unwritten", description: "Not automated yet." });
  assert.throws(() => journeySpecs(c), /unwritten/);
});

test("only the secrets granted to journeys pass through", () => {
  assert.deepEqual(stageSecrets(config(), received), { PREVIEW_BYPASS_SECRET: "bypass-value" });
});

test("a granted secret that wasn't received fails, naming it and nothing else", () => {
  assert.throws(
    () => stageSecrets(config(), JSON.stringify({ OTHER_STAGE_KEY: "other-value" })),
    (e: Error) => e instanceof JourneyError && /PREVIEW_BYPASS_SECRET/.test(e.message) && !/other-value/.test(e.message),
  );
  assert.throws(() => stageSecrets(config(), JSON.stringify({ PREVIEW_BYPASS_SECRET: "" })), JourneyError);
});

test("preview headers take their values from granted secrets", () => {
  assert.deepEqual(previewHeaders(config(), { PREVIEW_BYPASS_SECRET: "bypass-value" }), { "x-preview-bypass": "bypass-value" });
  assert.throws(() => previewHeaders(config(), {}), /x-preview-bypass/);
});

test("the tests get the URL, the headers and granted secrets, but not every secret or the job token", () => {
  const secrets = stageSecrets(config(), received);
  const env = journeyEnv("https://p.example.invalid", previewHeaders(config(), secrets), secrets, {
    PATH: "/bin",
    KIT_SECRETS: received,
    GITHUB_TOKEN: "job-token",
    GH_TOKEN: "job-token",
  });
  assert.equal(env.PIPELINE_PREVIEW_URL, "https://p.example.invalid");
  assert.deepEqual(JSON.parse(env.PIPELINE_PREVIEW_HEADERS!), { "x-preview-bypass": "bypass-value" });
  assert.equal(env.PREVIEW_BYPASS_SECRET, "bypass-value");
  assert.equal(env.KIT_SECRETS, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.OTHER_STAGE_KEY, undefined);
  assert.equal(env.PATH, "/bin");
});

test("journeys run with the project's own Playwright, never a fresh download", () => {
  let call: { cmd: string; args: string[] } | undefined;
  const code = runJourneys(["e2e/a.spec.ts"], {}, (cmd, args) => {
    call = { cmd, args };
    return 1;
  });
  assert.equal(code, 1);
  assert.deepEqual(call, { cmd: "npx", args: ["--no-install", "playwright", "test", "e2e/a.spec.ts"] });
});

test("the summary names journeys and the preview, never header values", () => {
  const s = journeysSummary(config(), "https://p.example.invalid", 1);
  assert.match(s, /failed/);
  assert.match(s, /browse-sample/);
  assert.doesNotMatch(s, /bypass-value/);
});

test("config: a header must use a secret granted to journeys", () => {
  const bad = WITH_JOURNEYS.replace("journeys: [PREVIEW_BYPASS_SECRET]", "journeys: []");
  assert.throws(() => parseConfig(bad, "example.yml"), (e: Error) => e instanceof ConfigError && /previews\.headers\.x-preview-bypass/.test(e.message));
});

test("config: journeys need previews", () => {
  const bad = WITH_JOURNEYS.replace("source: deployment\n  environment: Preview", "source: none");
  assert.throws(() => parseConfig(bad, "example.yml"), /journeys run against a preview/);
});

test("config: source deployment needs an environment; header values are secret names, not values", () => {
  assert.throws(() => parseConfig(WITH_JOURNEYS.replace("  environment: Preview\n", ""), "example.yml"), ConfigError);
  assert.throws(() => parseConfig(WITH_JOURNEYS.replace("x-preview-bypass: PREVIEW_BYPASS_SECRET", "x-preview-bypass: not-a-name"), "example.yml"), ConfigError);
});

test("config: previews default to a 10-minute wait and no headers", () => {
  const c = parseConfig(`${EXAMPLE_YAML}\npreviews:\n  source: deployment\n  environment: Preview\n`, "example.yml");
  assert.equal(c.previews!.timeoutMinutes, 10);
  assert.deepEqual(c.previews!.headers, {});
});

test("secrets.journeys may only name secrets the kit's workflow declares", () => {
  const undeclared = WITH_JOURNEYS.replaceAll("PREVIEW_BYPASS_SECRET", "SOME_OTHER_SECRET");
  assert.throws(() => parseConfig(undeclared, "example.yml"), (e: Error) => e instanceof ConfigError && /SOME_OTHER_SECRET/.test(e.message) && /declare/.test(e.message));
});

test("the workflow declares exactly the journey secret slots the config check allows", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
  const declared = Object.keys(workflow.on.workflow_call.secrets ?? {}).sort();
  assert.deepEqual(declared, [...JOURNEY_SECRET_SLOTS].sort());
});
