import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createServices, safeURL } from "../integrations.mjs";
import { createSettingsStore } from "../settings.mjs";
import { createProvider, providerCapabilities } from "../hosting.mjs";
const mockRead = async (body) =>
  body.action === "state"
    ? { branch: "main", files: [{ path: "file.txt" }], commits: [] }
    : { diff: "diff --git a/file.txt b/file.txt\n+hello" };
async function setup(t, config = {}, fetchImpl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branchwork-services-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const settings = createSettingsStore({ directory: dir });
  for (const [key, value] of Object.entries(config))
    await settings.update(key, value);
  return {
    settings,
    services: createServices({ settings, read: mockRead, fetchImpl }),
  };
}
test("disabled AI refuses all transmission and unconfirmed AI sends nothing", async (t) => {
  let calls = 0;
  const { settings, services } = await setup(t, {}, async () => {
    calls++;
  });
  await assert.rejects(
    services.handle({
      action: "ai-run",
      repo: "/repo",
      task: "review-changes",
      confirmed: true,
    }),
    /disabled/,
  );
  await settings.update("ai", { enabled: true });
  await assert.rejects(
    services.handle({
      action: "ai-run",
      repo: "/repo",
      task: "review-changes",
    }),
    /Confirm/,
  );
  assert.equal(calls, 0);
});
test("cloud uses configured endpoint/model/key with bounded preview; secrets remain server side", async (t) => {
  let request;
  const { settings, services } = await setup(
    t,
    {
      ai: {
        enabled: true,
        model: "user-model",
        apiKey: "secret-key",
        baseUrl: "http://localhost:8787/v1",
      },
    },
    async (url, init) => {
      request = { url: String(url), ...init };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Suggested commit" } }],
        }),
      );
    },
  );
  const preview = await services.handle({
    action: "ai-preview",
    repo: "/repo",
    task: "commit-message",
  });
  assert.match(preview.context, /hello/);
  assert.equal(preview.destination, "http://localhost:8787/v1");
  const result = await services.handle({
    action: "ai-run",
    repo: "/repo",
    previewId: preview.previewId,
    confirmed: true,
  });
  assert.equal(result.text, "Suggested commit");
  assert.equal(request.headers.Authorization, "Bearer secret-key");
  assert.equal(JSON.parse(request.body).model, "user-model");
  assert.equal(request.redirect, "error");
  assert.equal(
    JSON.stringify(await services.handle({ action: "ai-config" })).includes(
      "secret-key",
    ),
    false,
  );
  await services.handle({
    action: "ai-config-save",
    config: { enabled: false, mode: "cloud", apiKey: "" },
  });
  assert.equal((await settings.load()).ai.apiKey, "secret-key");
  await services.handle({
    action: "ai-config-save",
    config: { enabled: false, mode: "cloud", clearKey: true },
  });
  assert.equal((await settings.load()).ai.apiKey, "");
});
test("failed cloud response never echoes upstream secret", async (t) => {
  const { services } = await setup(
    t,
    { ai: { enabled: true, model: "m", apiKey: "very-secret" } },
    async () => new Response("very-secret", { status: 401 }),
  );
  const preview = await services.handle({
    action: "ai-preview",
    repo: "/repo",
    task: "chat",
  });
  await assert.rejects(
    services.handle({
      action: "ai-run",
      repo: "/repo",
      previewId: preview.previewId,
      confirmed: true,
    }),
    (e) => e.message.includes("401") && !e.message.includes("very-secret"),
  );
});
test("URL validation rejects nonlocal plaintext and embedded credentials", () => {
  assert.throws(() => safeURL("http://example.com"));
  assert.throws(() => safeURL("https://user:secret@example.com"));
  assert.equal(safeURL("http://127.0.0.1:3000").hostname, "127.0.0.1");
});
test("AI sends exactly approved snapshot and refuses changed destination or replay", async (t) => {
  let transmitted;
  const { settings, services } = await setup(
    t,
    { ai: { enabled: true, model: "m", apiKey: "key" } },
    async (url, init) => {
      transmitted = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      );
    },
  );
  const preview = await services.handle({
    action: "ai-preview",
    repo: "/repo",
    task: "review-changes",
    prompt: "approved prompt",
  });
  const result = await services.handle({
    action: "ai-run",
    repo: "/repo",
    task: "chat",
    prompt: "replacement prompt",
    previewId: preview.previewId,
    confirmed: true,
  });
  assert.equal(result.task, "review-changes");
  assert.match(transmitted.messages[1].content, /approved prompt/);
  assert.doesNotMatch(transmitted.messages[1].content, /replacement prompt/);
  await assert.rejects(
    services.handle({
      action: "ai-run",
      repo: "/repo",
      previewId: preview.previewId,
      confirmed: true,
    }),
    /Preview/,
  );
  const next = await services.handle({
    action: "ai-preview",
    repo: "/repo",
    task: "chat",
  });
  await settings.update("ai", { baseUrl: "https://example.com/v1" });
  await assert.rejects(
    services.handle({
      action: "ai-run",
      repo: "/repo",
      previewId: next.previewId,
      confirmed: true,
    }),
    /configuration changed/,
  );
});
test("AI preview clips large context and uses local changes for tasks other than explain-commit", async (t) => {
  const calls = [];
  const services = createServices({
    settings: { load: async () => ({ ai: {} }) },
    read: async (body) => {
      calls.push(body);
      return body.action === "state"
        ? { branch: "main", files: [], commits: [] }
        : { diff: "a".repeat(150000) };
    },
  });
  const preview = await services.handle({
    action: "ai-preview",
    repo: "/repo",
    task: "commit-message",
    commit: "HEAD",
  });
  assert.equal(preview.truncated, true);
  assert.ok(preview.bytes <= 100003);
  assert.equal(
    calls.some((c) => c.action === "diff" && c.commit),
    false,
  );
});
test("stash-message preview uses local diffs; changelog discloses exact range and evidence limits", async () => {
  const calls = [];
  const services = createServices({
    settings: { load: async () => ({ ai: {} }) },
    read: async (body) => {
      calls.push(body);
      if (body.action === "state")
        return {
          branch: "main",
          files: [],
          commits: [{ subject: "Recent change" }],
        };
      if (body.action === "compare")
        return { diff: "range diff", stat: "1 file" };
      return { diff: body.staged ? "staged patch" : "working patch" };
    },
  });
  const stash = await services.handle({
    action: "ai-preview",
    repo: "/repo",
    task: "stash-message",
    commit: "HEAD",
  });
  assert.match(stash.context, /working patch/);
  assert.match(stash.context, /staged patch/);
  const log = await services.handle({
    action: "ai-preview",
    repo: "/repo",
    task: "changelog",
    from: "v1",
    to: "HEAD",
  });
  assert.match(log.context, /range diff/);
  assert.match(log.context, /may include commits outside the range/);
  assert.deepEqual(
    calls.find((c) => c.action === "compare"),
    { repo: "/repo", action: "compare", from: "v1", to: "HEAD" },
  );
  const recent = await services.handle({
    action: "ai-preview",
    repo: "/repo",
    task: "changelog",
  });
  assert.match(recent.context, /not a complete release changelog/);
  await assert.rejects(
    services.handle({
      action: "ai-preview",
      repo: "/repo",
      task: "changelog",
      from: "v1",
    }),
    /both/,
  );
});
test("hosting readiness reflects explicit provider evidence and unknown remains null", async () => {
  for (const [type, item, expected] of [
    [
      "github",
      {
        number: 1,
        draft: true,
        mergeable: false,
        requested_reviewers: [{ login: "reviewer" }],
      },
      {
        draft: true,
        conflicts: true,
        reviewState: "review-requested",
        checksState: null,
      },
    ],
    [
      "gitlab",
      {
        iid: 2,
        work_in_progress: false,
        has_conflicts: false,
        head_pipeline: { status: "failed" },
      },
      {
        draft: false,
        conflicts: false,
        reviewState: null,
        checksState: "failed",
      },
    ],
    [
      "azure",
      { pullRequestId: 3, isDraft: true, mergeStatus: "conflicts" },
      { draft: true, conflicts: true, reviewState: null, checksState: null },
    ],
    [
      "bitbucket",
      { id: 4, state: "OPEN" },
      { draft: null, conflicts: null, reviewState: null, checksState: null },
    ],
  ]) {
    const provider = createProvider(
      { type, token: "secret" },
      async () => new Response(JSON.stringify([item])),
    );
    const result = await provider.handle({
      action: "provider-list",
      kind: "pulls",
    });
    for (const [key, value] of Object.entries(expected))
      assert.equal(result.items[0][key], value, type + " " + key);
  }
});
test("provider rejects unsupported methods and events without transmission", async () => {
  let calls = 0;
  for (const type of ["gitlab", "bitbucket"]) {
    const provider = createProvider({ type, token: "secret" }, async () => {
      calls++;
      return new Response("{}");
    });
    await assert.rejects(
      provider.handle({
        action: "provider-merge",
        number: 1,
        method: "rebase",
      }),
      /Unsupported merge method/,
    );
  }
  const provider = createProvider(
    { type: "gitlab", token: "secret" },
    async () => {
      calls++;
      return new Response("{}");
    },
  );
  await assert.rejects(
    provider.handle({
      action: "provider-review",
      number: 1,
      event: "REQUEST_CHANGES",
    }),
    /unavailable/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(providerCapabilities("gitlab").reviewEvents, [
    "APPROVE",
    "COMMENT",
  ]);
});
test("GitHub merge false is an error even when HTTP succeeded", async () => {
  const provider = createProvider(
    { type: "github", token: "secret" },
    async () =>
      new Response(JSON.stringify({ merged: false, message: "not merged" })),
  );
  await assert.rejects(
    provider.handle({ action: "provider-merge", number: 1, method: "merge" }),
    /did not merge/,
  );
});
test("GitHub item detail survives checks authorization failure with explicit warning", async () => {
  const provider = createProvider(
    { type: "github", owner: "o", repository: "r", token: "secret" },
    async (url) => {
      const p = new URL(url).pathname;
      if (p.endsWith("/check-runs"))
        return new Response("secret", { status: 403 });
      return new Response(
        JSON.stringify(
          p.endsWith("/pulls/1")
            ? { number: 1, title: "PR", head: { sha: "abc" } }
            : [],
        ),
      );
    },
  );
  const result = await provider.handle({
    action: "provider-detail",
    kind: "pulls",
    number: 1,
  });
  assert.equal(result.item.title, "PR");
  assert.equal(result.checks.length, 0);
  assert.match(result.warnings[0], /Checks unavailable/);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
test("Azure detail uses latest iteration change paths and rebase keeps requested semantics", async () => {
  const calls = [];
  const provider = createProvider(
    {
      type: "azure",
      organization: "o",
      project: "p",
      repository: "r",
      token: "secret",
    },
    async (url, init) => {
      const p = new URL(url).pathname;
      calls.push({ url: String(url), ...init });
      let data = {};
      if (p.endsWith("/iterations")) data = { value: [{ id: 1 }, { id: 2 }] };
      else if (p.endsWith("/iterations/2/changes"))
        data = {
          changeEntries: [{ item: { path: "/README.md" }, changeType: "edit" }],
        };
      else if (p.endsWith("/pullrequests/1"))
        data = {
          pullRequestId: 1,
          title: "PR",
          lastMergeSourceCommit: { commitId: "abc" },
        };
      else data = { value: [] };
      return new Response(JSON.stringify(data));
    },
  );
  const detail = await provider.handle({
    action: "provider-detail",
    kind: "pulls",
    number: 1,
  });
  assert.equal(detail.files[0].path, "/README.md");
  await provider.handle({
    action: "provider-merge",
    number: 1,
    method: "rebase",
  });
  const request = calls.find((c) => c.method === "PATCH");
  assert.equal(
    JSON.parse(request.body).completionOptions.mergeStrategy,
    "rebase",
  );
});
test("GitHub actual HTTP mock normalizes read and explicit write requests and protects tokens", async (t) => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    calls.push({
      url: req.url,
      method: req.method,
      auth: req.headers.authorization,
      body: raw ? JSON.parse(raw) : null,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url.includes("/pulls?"))
      res.end(
        JSON.stringify([
          {
            number: 3,
            title: "Fix",
            state: "open",
            user: { login: "alice" },
            head: { ref: "feature" },
            base: { ref: "main" },
            html_url: "https://github.com/o/r/pull/3",
          },
        ]),
      );
    else if (req.url.endsWith("/merge"))
      res.end(JSON.stringify({ merged: true }));
    else res.end(JSON.stringify({ number: 4, title: "New PR" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { settings, services } = await setup(t, {
    provider: {
      type: "github",
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      owner: "o",
      repository: "r",
      token: "secret-token",
    },
  });
  const result = await services.handle({
    action: "provider-list",
    kind: "pulls",
  });
  assert.equal(result.items[0].number, 3);
  assert.equal(result.items[0].head, "feature");
  assert.equal(calls[0].auth, "Bearer secret-token");
  assert.equal(calls.length, 1);
  await services.handle({
    action: "provider-create-pr",
    title: "New PR",
    head: "feature",
    base: "main",
    body: "Description",
  });
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(calls[1].body, {
    title: "New PR",
    head: "feature",
    base: "main",
    body: "Description",
  });
  await services.handle({
    action: "provider-merge",
    number: 4,
    method: "squash",
  });
  assert.equal(calls[2].method, "PUT");
  assert.equal(calls[2].body.merge_method, "squash");
  assert.equal(
    JSON.stringify(
      await services.handle({ action: "provider-config" }),
    ).includes("secret-token"),
    false,
  );
  await services.handle({
    action: "provider-config-save",
    config: { type: "github", token: "" },
  });
  assert.equal((await settings.load()).provider.token, "secret-token");
  await services.handle({
    action: "provider-config-save",
    config: { type: "github", clearToken: true },
  });
  assert.equal((await settings.load()).provider.token, "");
});
test("GitLab, Bitbucket and Azure adapt repository APIs and auth", async (t) => {
  for (const type of ["gitlab", "bitbucket", "azure"]) {
    const calls = [];
    const { services } = await setup(
      t,
      {
        provider: {
          type,
          baseUrl: "http://localhost:7777",
          owner: "org",
          repository: "repo",
          project: "p",
          organization: "org",
          token: "secret",
        },
      },
      async (url, init) => {
        calls.push({ url: String(url), ...init });
        return new Response(
          JSON.stringify(
            type === "gitlab"
              ? [{ iid: 1, title: "MR" }]
              : type === "azure"
                ? { value: [{ pullRequestId: 1, title: "PR" }] }
                : { values: [{ id: 1, title: "PR" }] },
          ),
        );
      },
    );
    const { items } = await services.handle({
      action: "provider-list",
      kind: "pulls",
    });
    assert.equal(items[0].number, 1);
    assert.equal(calls.length, 1);
    if (type === "gitlab")
      assert.equal(calls[0].headers["PRIVATE-TOKEN"], "secret");
    if (type === "azure")
      assert.match(calls[0].headers.Authorization, /^Basic /);
    await services.handle({
      action: "provider-create-pr",
      title: "new",
      head: "topic",
      base: "main",
    });
    assert.equal(calls[1].method, "POST");
    assert.equal(JSON.stringify(calls[1].body).includes("secret"), false);
  }
});
