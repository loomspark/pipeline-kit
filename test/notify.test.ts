import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverChats, formatNotice, notify, notifyConfigFromEnv, validateNotice } from "../src/notify.ts";
import type { Notice } from "../src/notify.ts";

// Fictional values only. The token is assembled at runtime so no file holds a token-shaped string.
const TOKEN = ["123456", "fake-token-for-tests"].join(":");
const CONFIG = { botToken: TOKEN, chatId: "-1001", topicId: "42", source: "example-app" };

const DIGEST: Notice = {
  level: "digest",
  title: "Daily collection",
  facts: [
    { label: "Groups", value: "10/12" },
    { label: "Posts", value: 1234 },
    { label: "Comments on", value: false },
    { label: "Credits left", value: null },
  ],
  links: [{ label: "Admin", url: "https://example.invalid/admin" }],
};

function recorder(response: { ok: boolean; status: number; json?: unknown } = { ok: true, status: 200 }) {
  const calls: { url: string; body: any }[] = [];
  const fetch = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: response.ok, status: response.status, json: async () => response.json ?? {} };
  };
  return { calls, fetch };
}

test("a digest is sent silently to the configured topic", async () => {
  const r = recorder();
  assert.deepEqual(await notify(DIGEST, { config: CONFIG, fetch: r.fetch }), { sent: true });
  assert.equal(r.calls.length, 1);
  const { url, body } = r.calls[0];
  assert.equal(url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(body.chat_id, "-1001");
  assert.equal(body.message_thread_id, 42);
  assert.equal(body.disable_notification, true);
  assert.equal(body.parse_mode, "HTML");
  assert.match(body.text, /Daily collection/);
  assert.match(body.text, /Posts: <b>1,234<\/b>/);
  assert.match(body.text, /Comments on: <b>no<\/b>/);
  assert.match(body.text, /<a href="https:\/\/example.invalid\/admin">Admin<\/a>/);
});

test("an alert is sent with sound", async () => {
  const r = recorder();
  await notify({ level: "alert", title: "Daily collection failed" }, { config: CONFIG, fetch: r.fetch });
  assert.equal(r.calls[0].body.disable_notification, false);
  assert.match(r.calls[0].body.text, /^🔴/);
});

test("without a token or chat it does nothing", async () => {
  const r = recorder();
  assert.deepEqual(await notify(DIGEST, { config: { chatId: "-1001" }, fetch: r.fetch }), { sent: false, reason: "not-configured" });
  assert.deepEqual(await notify(DIGEST, { config: { botToken: TOKEN }, fetch: r.fetch }), { sent: false, reason: "not-configured" });
  assert.equal(r.calls.length, 0);
});

test("no topic sends to the group's General topic", async () => {
  const r = recorder();
  await notify(DIGEST, { config: { botToken: TOKEN, chatId: "-1001" }, fetch: r.fetch });
  assert.equal("message_thread_id" in r.calls[0].body, false);
});

test("Telegram errors and network failures are returned, never thrown, and never carry the token", async () => {
  const bad = recorder({ ok: false, status: 400, json: { description: "Bad Request: message thread not found" } });
  const r1 = await notify(DIGEST, { config: CONFIG, fetch: bad.fetch });
  assert.deepEqual(r1, { sent: false, reason: "failed", detail: "HTTP 400: Bad Request: message thread not found" });

  const throwing = async () => {
    throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
  };
  const r2 = await notify(DIGEST, { config: CONFIG, fetch: throwing });
  assert.deepEqual(r2, { sent: false, reason: "failed", detail: "TypeError" });
  assert.doesNotMatch(JSON.stringify([r1, r2]), /fake-token/);
});

test("the notice shape keeps messages to short structured fields", () => {
  assert.deepEqual(validateNotice(DIGEST), []);
  const long = "x".repeat(200);
  const problems = validateNotice({
    level: "digest",
    title: "Line one\nline two",
    facts: [{ label: "Summary", value: long }, { label: "Bad", value: { text: "nested" } as any }],
    links: [{ label: "Plain", url: "http://example.invalid" }],
  });
  assert.ok(problems.some((p) => /title has a line break/.test(p)));
  assert.ok(problems.some((p) => /fact 1 value is longer than 80/.test(p)));
  assert.ok(problems.some((p) => /fact 2 value must be/.test(p)));
  assert.ok(problems.some((p) => /link 1 must be an https URL/.test(p)));
  assert.equal(validateNotice({ level: "loud" as any, title: "x" })[0], "level must be alert or digest");
});

test("an invalid notice is not sent", async () => {
  const r = recorder();
  const result = await notify({ level: "alert", title: "" }, { config: CONFIG, fetch: r.fetch });
  assert.equal(result.sent, false);
  assert.equal(result.sent === false && result.reason, "invalid");
  assert.equal(r.calls.length, 0);
});

test("text is escaped for Telegram HTML", () => {
  const text = formatNotice({ level: "digest", title: "A <b> & C", facts: [{ label: "Group", value: "Fish & Chips <Fans>" }] });
  assert.match(text, /A &lt;b&gt; &amp; C/);
  assert.match(text, /Fish &amp; Chips &lt;Fans&gt;/);
});

test("config comes from the environment, blanks count as unset", () => {
  assert.deepEqual(notifyConfigFromEnv({ TELEGRAM_BOT_TOKEN: " ", TELEGRAM_CHAT_ID: "-1001", TELEGRAM_TOPIC_ID: "7", NOTIFY_SOURCE: "app" }), {
    botToken: undefined,
    chatId: "-1001",
    topicId: "7",
    source: "app",
  });
});

test("discover lists groups and topics with IDs and names only", async () => {
  const updates = {
    result: [
      { message: { chat: { id: 5, type: "private" }, text: "hi" } },
      { message: { chat: { id: -1001, type: "supergroup", title: "Example Ops" }, message_thread_id: 7, is_topic_message: true, forum_topic_created: { name: "example-app" } } },
      { message: { chat: { id: -1001, type: "supergroup", title: "Example Ops" }, message_thread_id: 7, is_topic_message: true, text: "/start" } },
      { my_chat_member: { chat: { id: -1002, type: "supergroup", title: "Other" } } },
    ],
  };
  const r = recorder({ ok: true, status: 200, json: updates });
  assert.deepEqual(await discoverChats(TOKEN, { fetch: r.fetch }), [
    { chatId: "-1001", chatTitle: "Example Ops" },
    { chatId: "-1001", chatTitle: "Example Ops", topicId: "7", topicName: "example-app" },
    { chatId: "-1002", chatTitle: "Other" },
  ]);
});

test("the CLI skips quietly when unconfigured and exits 0", () => {
  const cli = join(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");
  const run = (args: string[]) =>
    spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });
  const ok = run(["notify", "--level", "digest", "--title", "Nightly build", "--fact", "Tests=120", "--link", "Run=https://example.invalid/run/1"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /skipped/);
  const usage = run(["notify", "--title", "No level"]);
  assert.equal(usage.status, 2);
});

test("notify.ts stays self-contained so projects can vendor it", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/notify.ts"), "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m);
});
