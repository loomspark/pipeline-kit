import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHub } from "../src/github.ts";
import { fakeGitHub } from "./helpers.ts";
import type { Call } from "./helpers.ts";

const repo = "example-org/example-app";

test("reviews are read across pages, oldest first", async () => {
  const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ user: { login: `u${from + i}` }, state: "COMMENTED", commit_id: "c", html_url: "h" }));
  const gh = fakeGitHub({
    [`GET /repos/${repo}/pulls/7/reviews`]: (c) => (new URLSearchParams(c.path.split("?")[1]).get("page") === "1" ? page(100, 0) : page(3, 100)),
  });
  const reviews = await new GitHub({ token: "t", repo, fetch: gh.fetch }).reviews(7);
  assert.equal(reviews.length, 103);
  assert.equal(reviews[102].user, "u102");
});

test("status descriptions are cut to GitHub's 140-character limit", async () => {
  const gh = fakeGitHub({ [`POST /repos/${repo}/statuses/abc`]: () => ({}) });
  await new GitHub({ token: "t", repo, fetch: gh.fetch }).setStatus("abc", { state: "failure", context: "x", description: "y".repeat(200) });
  assert.equal(gh.calls[0].body.description.length, 140);
  assert.equal(gh.calls[0].auth, "Bearer t");
});

test("the risk comment is created once, then edited in place; people's comments are never edited", async () => {
  const comments = [{ id: 1, user: { type: "User" }, body: "<!-- m -->\nsomeone copied the marker" }];
  const routes = {
    [`GET /repos/${repo}/issues/7/comments`]: () => comments,
    [`POST /repos/${repo}/issues/7/comments`]: (c: Call) => {
      comments.push({ id: 2, user: { type: "Bot" }, body: c.body.body });
      return {};
    },
    [`PATCH /repos/${repo}/issues/comments/2`]: (c: Call) => {
      comments[1].body = c.body.body;
      return {};
    },
  };
  const gh = fakeGitHub(routes);
  const client = new GitHub({ token: "t", repo, fetch: gh.fetch });
  await client.upsertComment(7, "<!-- m -->", "first");
  await client.upsertComment(7, "<!-- m -->", "second");
  await client.upsertComment(7, "<!-- m -->", "second"); // unchanged: no edit
  assert.deepEqual(gh.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`), [
    `POST /repos/${repo}/issues/7/comments`,
    `PATCH /repos/${repo}/issues/comments/2`,
  ]);
  assert.equal(comments[0].body, "<!-- m -->\nsomeone copied the marker");
  assert.equal(comments[1].body, "<!-- m -->\nsecond");
});

test("errors name the call and status, not the response body", async () => {
  const gh = fakeGitHub({});
  await assert.rejects(new GitHub({ token: "t", repo, fetch: gh.fetch }).reviews(1), /GitHub GET \/repos\/example-org\/example-app\/pulls\/1\/reviews failed: HTTP 404/);
});

