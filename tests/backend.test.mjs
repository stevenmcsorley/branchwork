import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import { createServer, read, write } from "../server.mjs";
const exec = promisify(execFile);
test("isolated repository workflows through HTTP API", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "git-client-test-"));
  const repo = path.join(temp, "repo");
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await fs.rm(temp, { recursive: true, force: true });
  });
  const api = async (kind, action, data = {}) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/${kind}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, action, ...data }),
      },
    );
    return { status: response.status, ...(await response.json()) };
  };
  assert.equal((await api("write", "init", { path: repo })).status, 200);
  await exec("git", ["-C", repo, "config", "user.name", "Test"]);
  await exec("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "test@example.invalid",
  ]);
  await fs.writeFile(path.join(repo, "hello.txt"), "hello\n");
  let state = await api("read", "state");
  assert.equal(state.files[0].path, "hello.txt");
  assert.equal(state.commits.length, 0);
  assert.match(
    (await api("read", "diff", { path: "hello.txt" })).diff,
    /\+hello/,
  );
  assert.equal(
    (await api("write", "stage", { paths: ["hello.txt"] })).status,
    200,
  );
  assert.match(
    (await api("read", "diff", { path: "hello.txt", staged: true })).diff,
    /\+hello/,
  );
  assert.equal(
    (await api("write", "commit", { message: "Initial commit" })).status,
    200,
  );
  state = await api("read", "state");
  assert.equal(state.commits[0].subject, "Initial commit");
  assert.equal(state.files.length, 0);
  const initial = state.commits[0].hash;
  assert.deepEqual(
    (await api("read", "commit-files", { commit: initial })).files.map(
      (f) => f.path,
    ),
    ["hello.txt"],
  );
  assert.match(
    (await api("read", "diff", { commit: initial, path: "hello.txt" })).diff,
    /\+hello/,
  );
  assert.equal(
    (await api("read", "show", { commit: initial, path: "hello.txt" })).content,
    "hello\n",
  );
  assert.equal((await api("write", "branch", { name: "feature" })).status, 200);
  assert.equal(
    (await api("write", "checkout", { ref: "feature" })).status,
    200,
  );
  assert.equal((await api("read", "state")).branch, "feature");
  await fs.writeFile(path.join(repo, "hello.txt"), "changed\n");
  await api("write", "stage", { paths: ["hello.txt"] });
  assert.equal(
    (await api("write", "unstage", { paths: ["hello.txt"] })).status,
    200,
  );
  assert.equal((await api("read", "state")).files[0].worktree, "M");
  assert.equal((await api("write", "arbitrary-command")).status, 400);
  assert.equal(
    (await api("write", "stage", { paths: ["../outside"] })).status,
    400,
  );
  assert.equal((await api("write", "checkout", { ref: "--help" })).status, 400);
  const crossOrigin = await fetch(
    `http://127.0.0.1:${server.address().port}/api/write`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.invalid",
      },
      body: JSON.stringify({ repo, action: "stash" }),
    },
  );
  assert.equal(crossOrigin.status, 403);
});
test("partial index patches, worktrees, local identity and validated interactive rebase", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "git-client-local-")),
    repo = path.join(temp, "repo"),
    tree = path.join(temp, "secondary");
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const change = (action, data = {}) => write({ repo, action, ...data });
  const inspect = (action, data = {}) => read({ repo, action, ...data });
  await change("init");
  await change("config", {
    name: "Local Test",
    email: "local@example.invalid",
  });
  assert.deepEqual(await inspect("config"), {
    name: "Local Test",
    email: "local@example.invalid",
  });
  await fs.writeFile(path.join(repo, "partial.txt"), "one\ntwo\nthree\n");
  await change("stage", { paths: ["partial.txt"] });
  await change("commit", { message: "base" });
  await fs.writeFile(path.join(repo, "partial.txt"), "ONE\ntwo\nTHREE\n");
  const patch =
    "diff --git a/partial.txt b/partial.txt\n--- a/partial.txt\n+++ b/partial.txt\n@@ -1,3 +1,3 @@\n-one\n+ONE\n two\n three\n";
  await change("apply-patch", { patch });
  const staged = (await inspect("diff", { staged: true, path: "partial.txt" }))
    .diff;
  assert.match(staged, /\+ONE/);
  assert.doesNotMatch(staged, /\+THREE/);
  assert.match(
    (await inspect("diff", { path: "partial.txt" })).diff,
    /\+THREE/,
  );
  await change("apply-patch", { patch, reverse: true });
  assert.equal((await inspect("diff", { staged: true })).diff, "");
  await assert.rejects(change("apply-patch", { patch: "not a patch" }));
  await change("discard", { paths: ["partial.txt"] });
  assert.equal(
    await fs.readFile(path.join(repo, "partial.txt"), "utf8"),
    "one\ntwo\nthree\n",
  );
  await fs.writeFile(path.join(repo, "untracked.txt"), "keep");
  await assert.rejects(change("discard", { paths: ["untracked.txt"] }));
  assert.equal(
    await fs.readFile(path.join(repo, "untracked.txt"), "utf8"),
    "keep",
  );
  await fs.unlink(path.join(repo, "untracked.txt"));
  await change("worktree-add", { path: tree, branch: "secondary" });
  const worktrees = (await inspect("worktrees")).worktrees;
  assert.equal(worktrees.length, 2);
  assert.ok(worktrees.some((w) => w.path === tree && w.branch === "secondary"));
  await change("worktree-remove", { path: tree });
  assert.equal((await inspect("worktrees")).worktrees.length, 1);
  assert.deepEqual((await inspect("submodules")).submodules, []);
  assert.equal(typeof (await inspect("lfs")).installed, "boolean");
  assert.equal((await inspect("state", { limit: 500 })).historyLimit, 500);
  await assert.rejects(inspect("history", { limit: 10 }));
  const base = (await inspect("state")).commits[0].hash;
  for (const [file, message] of [
    ["first.txt", "first"],
    ["second.txt", "second"],
  ]) {
    await fs.writeFile(path.join(repo, file), message + "\n");
    await change("stage", { paths: [file] });
    await change("commit", { message });
  }
  const states = (await inspect("state")).commits,
    steps = [
      { hash: states[1].hash, action: "pick" },
      { hash: states[0].hash, action: "fixup" },
    ];
  assert.deepEqual(
    (await inspect("rebase-plan", { onto: base })).commits.map((c) => c.hash),
    steps.map((s) => s.hash),
  );
  await assert.rejects(
    change("interactive-rebase", {
      onto: base,
      steps: [{ ...steps[0], action: "exec" }, steps[1]],
    }),
  );
  await change("interactive-rebase", { onto: base, steps });
  const after = (await inspect("state")).commits;
  assert.equal(after.length, 2);
  assert.equal(after[0].subject, "first");
  assert.equal(
    await fs.readFile(path.join(repo, "second.txt"), "utf8"),
    "second\n",
  );
  assert.equal(
    (await inspect("history", { limit: 250, offset: 1 })).commits[0].hash,
    base,
  );
  const source = path.join(temp, "module-source");
  await fs.mkdir(source);
  await exec("git", ["-C", source, "init"]);
  await exec("git", ["-C", source, "config", "user.name", "Module Test"]);
  await exec("git", [
    "-C",
    source,
    "config",
    "user.email",
    "module@example.invalid",
  ]);
  await fs.writeFile(path.join(source, "module.txt"), "module\n");
  await exec("git", ["-C", source, "add", "module.txt"]);
  await exec("git", ["-C", source, "commit", "-m", "module base"]);
  // File transport permission is limited to fixture setup; production uses normal Git policy.
  await exec("git", [
    "-C",
    repo,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    source,
    "modules/example",
  ]);
  await change("commit", { message: "add module" });
  const modules = (await inspect("submodules")).submodules;
  assert.equal(modules.length, 1);
  assert.equal(modules[0].path, "modules/example");
  assert.equal(modules[0].status, " ");
  assert.match(modules[0].hash, /^[0-9a-f]{40}$/);
  await change("submodule-update", { path: "modules/example" });
  assert.equal(
    await fs.readFile(path.join(repo, "modules/example/module.txt"), "utf8"),
    "module\n",
  );
});
test("merge recovery, unusual filenames, detached commits and local remote workflows", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "git-client-advanced-")),
    repo = path.join(temp, "repo"),
    remote = path.join(temp, "remote.git"),
    clone = path.join(temp, "clone");
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await fs.rm(temp, { recursive: true, force: true });
  });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const api = async (kind, action, data = {}) => {
    const response = await fetch(`${endpoint}/api/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, action, ...data }),
    });
    const result = await response.json();
    return { status: response.status, ...result };
  };
  const ok = async (action, data = {}) => {
    const result = await api("write", action, data);
    assert.equal(result.status, 200, result.error);
    return result;
  };
  const g = (...args) => exec("git", ["-C", repo, ...args]);
  await ok("init");
  await g("config", "user.name", "Test");
  await g("config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(repo, "conflict.txt"), "base\n");
  await ok("stage", { paths: ["conflict.txt"] });
  await ok("commit", { message: "base" });
  const main = (await api("read", "state")).branch;
  await ok("branch", { name: "feature" });
  await ok("checkout", { ref: "feature" });
  await fs.writeFile(path.join(repo, "conflict.txt"), "theirs\n");
  await ok("stage", { paths: ["conflict.txt"] });
  await ok("commit", { message: "feature change" });
  await ok("checkout", { ref: main });
  await fs.writeFile(path.join(repo, "conflict.txt"), "ours\n");
  await ok("stage", { paths: ["conflict.txt"] });
  await ok("commit", { message: "main change" });
  assert.equal((await api("write", "merge", { ref: "feature" })).status, 400);
  assert.equal((await api("read", "state")).operation, "merge");
  const conflict = await api("read", "conflict", { path: "conflict.txt" });
  assert.equal(conflict.base, "base\n");
  assert.equal(conflict.ours, "ours\n");
  assert.equal(conflict.theirs, "theirs\n");
  await ok("abort");
  assert.equal((await api("read", "state")).operation, null);
  assert.equal(
    await fs.readFile(path.join(repo, "conflict.txt"), "utf8"),
    "ours\n",
  );
  assert.equal((await api("write", "merge", { ref: "feature" })).status, 400);
  await ok("resolve-conflict", { path: "conflict.txt", content: "resolved\n" });
  await ok("continue");
  const merge = (await api("read", "state")).commits[0];
  assert.equal(merge.parents.length, 2);
  assert.deepEqual(
    (await api("read", "commit-files", { commit: merge.hash })).files.map(
      (f) => f.path,
    ),
    ["conflict.txt"],
  );
  const odd = "space and\nnewline.txt";
  await fs.writeFile(path.join(repo, odd), "odd\n");
  assert.ok((await api("read", "state")).files.some((f) => f.path === odd));
  await ok("stage", { paths: [odd] });
  await ok("commit", { message: "odd filename" });
  const renamed = "renamed with space.txt";
  await g("mv", odd, renamed);
  const renameState = await api("read", "state");
  assert.equal(renameState.files[0].path, renamed);
  assert.equal(renameState.files[0].index, "R");
  await ok("commit", { message: "rename" });
  await fs.writeFile(path.join(repo, renamed), "stash edit\n");
  await ok("stash", { message: "save work" });
  assert.equal(
    (await api("read", "state")).stash[0].subject.includes("save work"),
    true,
  );
  await ok("stash-pop");
  assert.equal(
    await fs.readFile(path.join(repo, renamed), "utf8"),
    "stash edit\n",
  );
  await ok("stage", { paths: [renamed] });
  await ok("commit", { message: "stashed edit" });
  await ok("tag", { name: "v1" });
  assert.ok((await api("read", "state")).tags.includes("v1"));
  await ok("branch", { name: "pick-source" });
  await ok("checkout", { ref: "pick-source" });
  await fs.writeFile(path.join(repo, "pick.txt"), "pick\n");
  await ok("stage", { paths: ["pick.txt"] });
  await ok("commit", { message: "pick me" });
  const picked = (await api("read", "state")).commits[0].hash;
  await ok("checkout", { ref: main });
  await ok("cherry-pick", { ref: picked });
  assert.equal(
    await fs.readFile(path.join(repo, "pick.txt"), "utf8"),
    "pick\n",
  );
  await ok("revert", { ref: "HEAD" });
  await assert.rejects(fs.access(path.join(repo, "pick.txt")));
  await ok("checkout", { ref: "HEAD~1" });
  await fs.writeFile(path.join(repo, "detached.txt"), "detached\n");
  await ok("stage", { paths: ["detached.txt"] });
  await ok("commit", { message: "detached-only commit" });
  assert.ok(
    (await api("read", "state")).commits.some(
      (c) => c.subject === "detached-only commit",
    ),
  );
  await ok("checkout", { ref: main });
  await exec("git", ["init", "--bare", remote]);
  await g("remote", "add", "origin", remote);
  await g("push", "-u", "origin", main);
  await exec("git", [
    "--git-dir",
    remote,
    "symbolic-ref",
    "HEAD",
    `refs/heads/${main}`,
  ]);
  await ok("clone", { path: clone, url: remote });
  assert.equal((await api("read", "state", { repo: clone })).branch, main);
  await fs.writeFile(path.join(repo, "remote.txt"), "remote change\n");
  await ok("stage", { paths: ["remote.txt"] });
  await ok("commit", { message: "remote change" });
  await ok("push");
  await ok("fetch", { repo: clone });
  await ok("pull", { repo: clone });
  assert.equal(
    await fs.readFile(path.join(clone, "remote.txt"), "utf8"),
    "remote change\n",
  );
  await ok("branch", { name: "old-name" });
  await ok("branch-rename", { name: "old-name", newName: "new-name" });
  await ok("branch-delete", { name: "new-name" });
  const hostile = await new Promise((resolve, reject) => {
    http
      .get(
        `${endpoint}/api/health`,
        { headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(hostile, 403);
  const malformed = await fetch(`${endpoint}/api/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null",
  });
  assert.equal(malformed.status, 400);
});
