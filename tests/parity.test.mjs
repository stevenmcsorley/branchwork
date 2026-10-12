import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { read, write } from "../server.mjs";
const exec = promisify(execFile);
test("followed file history opens historical paths across spaces and newline renames", async (t) => {
  const { repo, w, r, g, commit } = await fixture(t);
  const old = "old name\nfile.txt",
    middle = "middle name\nfile.txt",
    current = "current name\nfile.txt";
  await commit(old, "original content\n", "original");
  await g("mv", "--", old, middle);
  await w("commit", { message: "rename middle" });
  await commit(middle, "modified content\n", "modified");
  await g("mv", "--", middle, current);
  await w("commit", { message: "rename current" });
  const history = (await r("file-history", { path: current })).commits;
  assert.deepEqual(
    history.map((c) => c.path),
    [current, middle, middle, old],
  );
  assert.deepEqual(
    history.map((c) => c.subject),
    ["rename current", "modified", "rename middle", "original"],
  );
  for (const entry of history) {
    const revision = await r("file-content", {
      path: entry.path,
      revision: entry.hash,
    });
    assert.equal(
      revision.content,
      entry.subject === "original" || entry.subject === "rename middle"
        ? "original content\n"
        : "modified content\n",
    );
    assert.ok(entry.author);
    assert.ok(entry.date);
  }
});
test("real editor content, line blame, revision browsing and optimistic save safeguards", async (t) => {
  const { repo, temp, w, r, g, commit } = await fixture(t);
  const first = await commit("file name.txt", "first\nsecond\n", "original");
  await fs.writeFile(path.join(repo, "untracked.txt"), "new\n");
  const files = (await r("files")).files;
  assert.deepEqual(files, [
    { path: "file name.txt", tracked: true },
    { path: "untracked.txt", tracked: false },
  ]);
  let content = await r("file-content", { path: "file name.txt" });
  assert.equal(content.content, "first\nsecond\n");
  assert.equal(content.binary, false);
  let blame = (await r("blame-lines", { path: "file name.txt" })).lines;
  assert.equal(blame.length, 2);
  assert.equal(blame[0].hash, first);
  assert.equal(blame[0].author, "Test");
  assert.equal(blame[1].line, 2);
  await w("save-file", {
    path: "file name.txt",
    content: "modified\nsecond\n",
    expectedSha256: content.sha256,
  });
  blame = (await r("blame-lines", { path: "file name.txt" })).lines;
  assert.match(blame[0].hash, /^0{40}$/);
  assert.equal(blame[1].hash, first);
  assert.equal(
    (await r("file-content", { path: "file name.txt", revision: first }))
      .content,
    "first\nsecond\n",
  );
  assert.equal(
    (await r("blame-lines", { path: "file name.txt", revision: first }))
      .lines[0].hash,
    first,
  );
  await assert.rejects(
    w("save-file", {
      path: "file name.txt",
      content: "stale",
      expectedSha256: content.sha256,
    }),
    /changed since opening/,
  );
  assert.equal(
    await fs.readFile(path.join(repo, "file name.txt"), "utf8"),
    "modified\nsecond\n",
  );
  await fs.writeFile(path.join(temp, "outside"), "outside");
  await fs.symlink(path.join(temp, "outside"), path.join(repo, "escape"));
  await assert.rejects(
    r("file-content", { path: "escape" }),
    /outside repository/,
  );
  await assert.rejects(
    w("save-file", {
      path: "escape",
      content: "overwrite",
      expectedSha256: content.sha256,
    }),
    /outside repository/,
  );
  await assert.rejects(r("file-content", { path: "../outside" }));
  await fs.writeFile(path.join(repo, "binary"), Buffer.from([0, 1, 2]));
  assert.equal((await r("file-content", { path: "binary" })).binary, true);
  await fs.writeFile(
    path.join(repo, "large"),
    Buffer.alloc(2 * 1024 * 1024 + 1),
  );
  await assert.rejects(r("file-content", { path: "large" }), /2 MB/);
  const detail = await r("commit-detail", { commit: first });
  assert.equal(detail.commit.message, "original\n");
  assert.equal(detail.commit.email, "test@example.invalid");
  assert.equal(detail.files[0].added, 2);
  assert.equal(detail.files[0].deleted, 0);
});
test("batch cherry-pick preserves selected order and supports conflict continuation", async (t) => {
  const { w, r, g, commit } = await fixture(t);
  const base = await commit("base", "base\n", "base");
  await w("branch", { name: "source" });
  await w("checkout", { ref: "source" });
  const one = await commit("one", "one\n", "one"),
    two = await commit("two", "two\n", "two");
  await w("branch", { name: "target", start: base });
  await w("checkout", { ref: "target" });
  await assert.rejects(
    w("batch-cherry-pick", { refs: [one, one] }),
    /Duplicate/,
  );
  await w("batch-cherry-pick", { refs: [two, one] });
  assert.equal(await g("log", "-2", "--format=%s"), "one\ntwo\n");
  assert.equal(await g("show", "HEAD:one"), "one\n");
  await w("checkout", { ref: "source" });
  const conflict = await commit("base", "source edit\n", "source edit"),
    after = await commit("after", "after\n", "after");
  await w("checkout", { ref: "target" });
  await commit("base", "target edit\n", "target edit");
  await assert.rejects(w("batch-cherry-pick", { refs: [conflict, after] }));
  assert.equal((await r("state")).operation, "cherry-pick");
  await w("resolve-conflict", { path: "base", choice: "theirs" });
  await w("continue");
  assert.equal((await r("state")).operation, null);
  assert.equal(await g("log", "-2", "--format=%s"), "after\nsource edit\n");
});
test("normal rebase preserves merge topology onto an advanced independent base", async (t) => {
  const { w, r, g, commit } = await fixture(t);
  const base = await commit("base", "base\n", "base");
  await w("branch", { name: "advanced", start: base });
  await w("branch", { name: "topic", start: base });
  await w("checkout", { ref: "topic" });
  await commit("topic", "topic\n", "topic");
  await w("branch", { name: "side", start: base });
  await w("checkout", { ref: "side" });
  await commit("side", "side\n", "side");
  await w("checkout", { ref: "topic" });
  await g("merge", "--no-ff", "--no-edit", "side");
  await w("checkout", { ref: "advanced" });
  const advanced = await commit("advanced", "advanced\n", "advanced");
  await w("checkout", { ref: "topic" });
  await assert.rejects(r("rebase-plan", { onto: base }), /linear history/);
  await w("rebase", { ref: "advanced", preserveMerges: true });
  const merges = (await g("rev-list", "--merges", `${advanced}..HEAD`))
    .trim()
    .split("\n");
  assert.equal(merges.length, 1);
  assert.equal(
    (await g("rev-list", "--parents", "-n", "1", merges[0])).trim().split(" ")
      .length,
    3,
  );
  await g("merge-base", "--is-ancestor", advanced, "HEAD");
  assert.equal(await g("show", "HEAD:side"), "side\n");
  assert.equal(await g("show", "HEAD:topic"), "topic\n");
  assert.equal(await g("show", "HEAD:advanced"), "advanced\n");
});
test("stash apply retains stash, annotated tags, signing controls and reset previews", async (t) => {
  const { repo, w, r, g, commit } = await fixture(t);
  const base = await commit("file", "base\n", "base");
  await fs.writeFile(path.join(repo, "file"), "changed\n");
  await w("stash", { message: "saved" });
  assert.match((await r("stash-show", { ref: "stash@{0}" })).diff, /changed/);
  await w("stash-apply", { ref: "stash@{0}" });
  assert.equal((await r("state")).stash.length, 1);
  await w("discard", { paths: ["file"] });
  await w("tag", { name: "annotated", message: "release", ref: base });
  assert.equal((await g("cat-file", "-t", "annotated")).trim(), "tag");
  await w("tag-delete", { name: "annotated" });
  assert.equal(await g("tag"), "");
  await w("signing-config", { enabled: true, key: "key-id" });
  assert.deepEqual(await r("signing-config"), { enabled: true, key: "key-id" });
  await w("signing-config", { enabled: false });
  assert.equal((await r("reset-preview", { ref: base })).target, base);
  await assert.rejects(w("push", { forceWithLease: true }));
  await assert.rejects(w("pull", { policy: "arbitrary" }));
  await w("gitignore", { content: "*.log\n" });
  assert.equal((await r("gitignore")).content, "*.log\n");
});
test("untracked files allow selected-line staging without staging remaining lines", async (t) => {
  const { repo, w, r, g } = await fixture(t);
  await fs.writeFile(path.join(repo, "new"), "first\nsecond\nthird\n");
  let diff = (await r("patch-lines", { path: "new" })).diff;
  await w("stage-lines", {
    path: "new",
    selectedLines: [diff.split("\n").indexOf("+second")],
  });
  assert.equal(await g("show", ":new"), "second\n");
  diff = (await r("patch-lines", { path: "new", staged: true })).diff;
  await w("unstage-lines", {
    path: "new",
    selectedLines: [diff.split("\n").indexOf("+second")],
  });
  assert.equal((await r("diff", { staged: true, path: "new" })).diff, "");
});
test("reword editor survives conflicts and edit pauses until continue", async (t) => {
  const { repo, w, r, g, commit } = await fixture(t);
  const base = await commit("file", "base\n", "base"),
    one = await commit("file", "one\n", "one"),
    two = await commit("file", "two\n", "two");
  await assert.rejects(
    w("interactive-rebase", {
      onto: base,
      steps: [
        { hash: two, action: "reword", message: "resolved two" },
        { hash: one, action: "drop" },
      ],
    }),
  );
  assert.equal((await r("state")).operation, "rebase");
  await w("resolve-conflict", { path: "file", choice: "theirs" });
  await w("continue");
  assert.equal(await g("log", "-1", "--format=%s"), "resolved two\n");
  assert.equal(await fs.readFile(path.join(repo, "file"), "utf8"), "two\n");
  const latest = (await g("rev-parse", "HEAD")).trim();
  await w("interactive-rebase", {
    onto: base,
    steps: [{ hash: latest, action: "edit" }],
  });
  assert.equal((await r("state")).operation, "rebase");
  await w("continue");
  assert.equal((await r("state")).operation, null);
});
test("line patches support insertions, removals, distant hunks and absent final newlines", async (t) => {
  const { repo, w, r, g, commit } = await fixture(t);
  const baseline = Array.from({ length: 35 }, (_, i) => `line ${i}`).join("\n");
  await commit("file", baseline, "base");
  const variants = [
    baseline
      .replace("line 1\n", "inserted\nline 1\n")
      .replace("line 30", "CHANGED"),
    baseline.replace("line 1\n", "").replace("line 30", "CHANGED"),
    baseline.replace("line 34", "LAST"),
  ];
  for (const variant of variants) {
    await fs.writeFile(path.join(repo, "file"), variant);
    let diff = (await r("patch-lines", { path: "file" })).diff;
    let selectedLines = diff
      .split("\n")
      .flatMap((line, i) =>
        /^[+-]/.test(line) && !line.startsWith("+++") && !line.startsWith("---")
          ? [i]
          : [],
      );
    await w("stage-lines", { path: "file", selectedLines });
    assert.equal(await g("show", ":file"), variant);
    diff = (await r("patch-lines", { path: "file", staged: true })).diff;
    selectedLines = diff
      .split("\n")
      .flatMap((line, i) =>
        /^[+-]/.test(line) && !line.startsWith("+++") && !line.startsWith("---")
          ? [i]
          : [],
      );
    await w("unstage-lines", { path: "file", selectedLines });
    assert.equal(await g("show", ":file"), baseline);
  }
});
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "branchwork-parity-")),
    repo = path.join(temp, "repo");
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const w = (action, data = {}) => write({ repo, action, ...data }),
    r = (action, data = {}) => read({ repo, action, ...data }),
    g = async (...args) => (await exec("git", ["-C", repo, ...args])).stdout;
  await w("init");
  await w("config", { name: "Test", email: "test@example.invalid" });
  const commit = async (file, text, message) => {
    await fs.writeFile(path.join(repo, file), text);
    await w("stage", { paths: [file] });
    await w("commit", { message });
    return (await g("rev-parse", "HEAD")).trim();
  };
  return { temp, repo, w, r, g, commit };
}
test("selected replacement lines stage, unstage and discard accurately", async (t) => {
  const { repo, w, r, g, commit } = await fixture(t);
  await commit("file", "a\nb\nc\nd\n", "base");
  await fs.writeFile(path.join(repo, "file"), "A\nb\nc\nD\n");
  let diff = (await r("patch-lines", { path: "file" })).diff;
  let selectedLines = diff
    .split("\n")
    .flatMap((line, i) => (["-a", "+A"].includes(line) ? [i] : []));
  await w("stage-lines", { path: "file", selectedLines });
  assert.equal(await g("show", ":file"), "A\nb\nc\nd\n");
  diff = (await r("patch-lines", { path: "file", staged: true })).diff;
  selectedLines = diff
    .split("\n")
    .flatMap((line, i) => (["-a", "+A"].includes(line) ? [i] : []));
  await w("unstage-lines", { path: "file", selectedLines });
  assert.equal(await g("show", ":file"), "a\nb\nc\nd\n");
  diff = (await r("patch-lines", { path: "file" })).diff;
  selectedLines = diff
    .split("\n")
    .flatMap((line, i) => (["-d", "+D"].includes(line) ? [i] : []));
  await w("discard-lines", { path: "file", selectedLines });
  assert.equal(
    await fs.readFile(path.join(repo, "file"), "utf8"),
    "A\nb\nc\nd\n",
  );
  await assert.rejects(w("stage-lines", { path: "file", selectedLines: [0] }));
});
test("rebase permutation and reword, file history and comparisons", async (t) => {
  const { w, r, g, commit } = await fixture(t);
  const base = await commit("base", "base\n", "base"),
    first = await commit("first", "first\n", "first"),
    second = await commit("second", "second\n", "second");
  await assert.rejects(
    w("interactive-rebase", {
      onto: base,
      steps: [
        { hash: first, action: "pick" },
        { hash: first, action: "drop" },
      ],
    }),
  );
  await w("interactive-rebase", {
    onto: base,
    steps: [
      { hash: second, action: "reword", message: "changed second" },
      { hash: first, action: "pick" },
    ],
  });
  assert.equal(await g("log", "--format=%s", "-2"), "first\nchanged second\n");
  assert.equal(
    (await r("file-history", { path: "second" })).commits[0].subject,
    "changed second",
  );
  assert.match((await r("compare", { from: base, to: "HEAD" })).stat, /second/);
});
test("Gitflow feature release and hotfix finishes, lock, raster versions and explicit reset", async (t) => {
  const { repo, temp, w, r, g, commit } = await fixture(t);
  await commit("base", "base\n", "base");
  await w("gitflow-init");
  for (const kind of ["feature", "release", "hotfix"]) {
    await w("gitflow-start", { kind, name: kind });
    await commit(kind, kind + "\n", kind);
    await w("gitflow-finish", { kind, name: kind });
  }
  assert.equal((await r("state")).branch, "develop");
  assert.match(await g("tag"), /release/);
  assert.match(await g("tag"), /hotfix/);
  assert.equal(await g("show", "main:hotfix"), "hotfix\n");
  const tree = path.join(temp, "tree");
  await w("worktree-add", { path: tree, branch: "tree" });
  await w("worktree-lock", { path: tree, reason: "test" });
  assert.ok(
    (await r("worktrees")).worktrees.find((x) => x.path === tree).locked,
  );
  await w("worktree-unlock", { path: tree });
  await w("worktree-remove", { path: tree });
  const bytes = Buffer.from("89504e470d0a1a0a", "hex");
  await fs.writeFile(path.join(repo, "pic.png"), bytes);
  await w("stage", { paths: ["pic.png"] });
  assert.equal(
    (await r("image-version", { path: "pic.png", version: "index" })).base64,
    bytes.toString("base64"),
  );
  await assert.rejects(
    r("image-version", { path: "bad.svg", version: "working" }),
  );
  await assert.rejects(w("reset", { ref: "HEAD", mode: "hard" }));
});
