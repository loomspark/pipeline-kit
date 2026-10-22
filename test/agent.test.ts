import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentEnv, agentSession, appJwt, loadAgentConfig } from "../src/agent.ts";
import { fakeGitHub } from "./helpers.ts";

// A throwaway key generated per run: no real key exists anywhere in the kit.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

test("app JWT is RS256-signed with the app id as issuer and a short life", () => {
  const jwt = appJwt("12345", pem, 1_000_000);
  const [h, p, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.deepEqual(payload, { iat: 999_940, exp: 1_000_540, iss: "12345" });
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url")));
});

test("agent session: installation token scoped to the one repo, and the bot's commit identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-agent-"));
  try {
    const keyFile = join(dir, "key.pem");
    writeFileSync(keyFile, pem);
    const repo = "example-org/example-app";
    const gh = fakeGitHub({
      "GET /app": () => ({ slug: "example-agent" }),
      [`GET /repos/${repo}/installation`]: () => ({ id: 42 }),
      "POST /app/installations/42/access_tokens": () => ({ token: "installation-token" }),
      "GET /users/example-agent%5Bbot%5D": () => ({ id: 999 }),
    });
    const s = await agentSession(repo, { appId: "1", keyFile }, gh.fetch);
    assert.deepEqual(s, { token: "installation-token", name: "example-agent[bot]", email: "999+example-agent[bot]@users.noreply.github.com" });
    const tokenCall = gh.calls.find((c) => c.path.endsWith("/access_tokens"))!;
    assert.deepEqual(tokenCall.body, { repositories: ["example-app"] });
    assert.match(tokenCall.auth!, /^Bearer ey/); // app JWT, not a person's token
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agent env authenticates only as the agent and commits as the bot", () => {
  const env = agentEnv({ token: "tok", name: "example-agent[bot]", email: "1+example-agent[bot]@users.noreply.github.com" }, { PATH: "/bin", GH_TOKEN: "a-persons-token" });
  assert.equal(env.GH_TOKEN, "tok");
  assert.equal(env.GIT_AUTHOR_NAME, "example-agent[bot]");
  assert.equal(env.GIT_COMMITTER_EMAIL, "1+example-agent[bot]@users.noreply.github.com");
  // Stored credential helpers are cleared so git can't fall back to a person's login.
  assert.equal(env.GIT_CONFIG_KEY_0, "credential.helper");
  assert.equal(env.GIT_CONFIG_VALUE_0, "");
  assert.equal(env.GIT_CONFIG_VALUE_1, `AUTHORIZATION: basic ${Buffer.from("x-access-token:tok").toString("base64")}`);
});

test("agent config comes from env or file, and says how to set it up when missing", () => {
  assert.deepEqual(loadAgentConfig({ KIT_AGENT_APP_ID: "7", KIT_AGENT_KEY_FILE: "/k.pem" }, "/nonexistent.json"), { appId: "7", keyFile: "/k.pem" });
  assert.throws(() => loadAgentConfig({}, "/nonexistent.json"), /docs\/agent-identity.md/);
});
