import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createSettingsStore } from "./settings.mjs";

const run = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const locks = new Map();
async function git(repo, args, extraEnv = {}) {
  try {
    return (
      await run("git", ["-C", repo, ...args], {
        timeout: ["fetch", "pull", "push", "submodule", "lfs"].includes(args[0])
          ? 120000
          : 60000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_EDITOR: "true",
          GIT_SEQUENCE_EDITOR: "true",
          ...extraEnv,
        },
      })
    ).stdout;
  } catch (e) {
    throw new Error((e.stderr || e.message).trim());
  }
}
function ref(value, label = "reference") {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("-") ||
    /[\0\r\n]/.test(value)
  )
    throw new Error(`Invalid ${label}`);
  return value;
}
function paths(values) {
  if (!Array.isArray(values) || !values.length)
    throw new Error("Select at least one file");
  return values.map((v) => {
    if (
      typeof v !== "string" ||
      !v ||
      path.isAbsolute(v) ||
      v.split(/[\\/]/).includes("..") ||
      v.includes("\0")
    )
      throw new Error("Invalid file path");
    return v;
  });
}
async function operation(repo) {
  for (const [file, type] of [
    ["MERGE_HEAD", "merge"],
    ["rebase-merge", "rebase"],
    ["rebase-apply", "rebase"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
  ]) {
    const location = (
      await git(repo, ["rev-parse", "--git-path", file])
    ).trim();
    try {
      await fs.access(path.resolve(repo, location));
      return type;
    } catch {}
  }
  return null;
}
function status(raw) {
  const fields = raw.split("\0"),
    result = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    const index = f[0],
      worktree = f[1],
      p = f.slice(3);
    result.push({ path: p, index, worktree });
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C")
      i++;
  }
  return result;
}
async function optional(repo, args) {
  try {
    return await git(repo, args);
  } catch {
    return "";
  }
}
function historyLimit(value) {
  const limit = value ?? 250;
  if (!Number.isInteger(limit) || limit < 250 || limit > 10000)
    throw new Error("History limit must be between 250 and 10000");
  return limit;
}
function commitsFrom(raw) {
  const chunks = raw.split("\0"),
    commits = [];
  for (let i = 0; i + 5 < chunks.length; i += 6)
    commits.push({
      hash: chunks[i].trim(),
      parents: chunks[i + 1].split(" ").filter(Boolean),
      subject: chunks[i + 2],
      author: chunks[i + 3],
      date: chunks[i + 4],
      refs: chunks[i + 5],
    });
  return commits;
}
async function history(repo, limit, offset = 0) {
  const hasHead = Boolean(
    await optional(repo, ["rev-parse", "--verify", "HEAD"]),
  );
  return commitsFrom(
    await optional(repo, [
      "log",
      "--topo-order",
      `--max-count=${limit}`,
      `--skip=${offset}`,
      "--all",
      "--date=iso-strict",
      "--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D%x00",
      ...(hasHead ? ["HEAD"] : []),
    ]),
  );
}
async function patchText(repo, file, staged = false) {
  const diff = await git(repo, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--unified=3",
    ...(staged ? ["--cached"] : []),
    "--",
    file,
  ]);
  if (diff || staged) return diff;
  const untracked = status(
    await git(repo, ["status", "--porcelain=v1", "-z"]),
  ).some((f) => f.path === file && f.index === "?");
  if (!untracked) return "";
  try {
    return (
      await run(
        "git",
        [
          "diff",
          "--no-index",
          "--no-ext-diff",
          "--no-textconv",
          "--",
          "/dev/null",
          file,
        ],
        { cwd: repo, maxBuffer: 1024 * 1024, timeout: 60000 },
      )
    ).stdout;
  } catch (e) {
    if (e.code === 1 && e.stdout) return e.stdout;
    throw new Error("File cannot be diffed");
  }
}
async function applyPatch(repo, patch, target = "index", reverse = false) {
  if (
    !["index", "worktree"].includes(target) ||
    typeof patch !== "string" ||
    !patch ||
    Buffer.byteLength(patch) > 1024 * 1024
  )
    throw new Error("Valid patch and target required (maximum 1 MB)");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "branchwork-patch-"));
  try {
    const file = path.join(temp, "patch");
    await fs.writeFile(file, patch);
    const flags = [
      "apply",
      ...(target === "index" ? ["--cached"] : []),
      ...(reverse ? ["--reverse"] : []),
    ];
    await git(repo, [...flags, "--check", "--", file]);
    return await git(repo, [...flags, "--", file]);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
function selectedPatch(diff, selection, reverse = false) {
  if (
    !Array.isArray(selection) ||
    !selection.length ||
    selection.some((x) => !Number.isInteger(x) || x < 0)
  )
    throw new Error("Select changed diff lines");
  const selected = new Set(selection),
    lines = diff.split("\n"),
    out = [];
  let i = 0,
    offset = 0,
    used = 0;
  if (reverse && lines.some((l) => l.startsWith("new file mode "))) {
    const additions = lines.flatMap((line, index) =>
      line.startsWith("+") && !line.startsWith("+++") ? [index] : [],
    );
    if (
      additions.length === selected.size &&
      additions.every((index) => selected.has(index))
    )
      return diff;
  }
  while (i < lines.length && !lines[i].startsWith("@@")) {
    if (lines[i]) out.push(lines[i]);
    i++;
  }
  while (i < lines.length && lines[i].startsWith("@@")) {
    const match = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) throw new Error("Unsupported diff");
    i++;
    const chunk = [];
    let oldCount = 0,
      newCount = 0,
      changed = false;
    let emitted = false;
    while (i < lines.length && !lines[i].startsWith("@@")) {
      const line = lines[i],
        index = i++;
      if (!line) continue;
      const kind = line[0];
      if (kind === "\\") {
        if (emitted) chunk.push(line);
        continue;
      }
      emitted = false;
      if (![" ", "+", "-"].includes(kind))
        throw new Error("Binary or unsupported patch");
      const choose = selected.has(index) && kind !== " ";
      if (choose) {
        used++;
        changed = true;
        emitted = true;
        chunk.push(line);
        if (kind === "-") oldCount++;
        else newCount++;
      } else if (kind === " ") {
        emitted = true;
        chunk.push(line);
        oldCount++;
        newCount++;
      } else if (kind === (reverse ? "+" : "-")) {
        emitted = true;
        chunk.push(" " + line.slice(1));
        oldCount++;
        newCount++;
      }
    }
    if (changed) {
      const base = Number(match[reverse ? 3 : 1]);
      let oldStart = reverse ? base + offset : base,
        newStart = reverse ? base : base + offset;
      if (oldCount === 0) oldStart = Math.max(0, oldStart);
      else oldStart = Math.max(1, oldStart);
      if (newCount === 0) newStart = Math.max(0, newStart);
      else newStart = Math.max(1, newStart);
      out.push(
        `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
        ...chunk,
      );
      offset += reverse ? oldCount - newCount : newCount - oldCount;
    }
  }
  if (used !== selected.size)
    throw new Error("Selection must contain only changed lines");
  if (reverse && out.some((l) => l.startsWith("new file mode "))) {
    const target = out.find((l) => l.startsWith("+++ b/"))?.slice(6);
    if (target) {
      for (let j = 0; j < out.length; j++) {
        if (out[j] === "--- /dev/null") out[j] = "--- a/" + target;
      }
      return (
        out.filter((l) => !l.startsWith("new file mode ")).join("\n") + "\n"
      );
    }
  }
  if (
    !reverse &&
    out.some((l) => l.startsWith("deleted file mode ")) &&
    out.some((l) => l.startsWith(" "))
  ) {
    const target = out.find((l) => l.startsWith("--- a/"))?.slice(6);
    if (target) {
      for (let j = 0; j < out.length; j++)
        if (out[j] === "+++ /dev/null") out[j] = "+++ b/" + target;
      return (
        out.filter((l) => !l.startsWith("deleted file mode ")).join("\n") + "\n"
      );
    }
  }
  return out.join("\n") + "\n";
}
async function flowConfig(repo) {
  const defaults = {
    main: "main",
    develop: "develop",
    feature: "feature/",
    release: "release/",
    hotfix: "hotfix/",
  };
  for (const key of Object.keys(defaults)) {
    const value = (
      await optional(repo, [
        "config",
        "--local",
        "--get",
        `branchwork.flow.${key}`,
      ])
    ).trim();
    if (value) defaults[key] = value;
  }
  return defaults;
}
async function rebaseEditor(repo) {
  const dir = (
    await git(repo, ["rev-parse", "--git-path", "branchwork-rebase"])
  ).trim();
  return path.resolve(repo, dir);
}
const editorLimit = 2 * 1024 * 1024;
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
function textFile(buffer) {
  let binary = buffer.includes(0),
    content = "";
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer,
    );
  } catch {
    binary = true;
  }
  return { content: binary ? "" : content, binary, sha256: sha256(buffer) };
}
async function containedFile(repo, file, allowNew = false) {
  if (file.split(/[\\/]/).includes(".git"))
    throw new Error("Git metadata cannot be edited");
  const realRepo = await fs.realpath(repo),
    candidate = path.join(realRepo, file);
  let resolved;
  try {
    resolved = await fs.realpath(candidate);
  } catch (e) {
    if (e.code !== "ENOENT" || !allowNew) throw e;
    const parent = await fs.realpath(path.dirname(candidate));
    resolved = path.join(parent, path.basename(candidate));
  }
  if (!resolved.startsWith(realRepo + path.sep))
    throw new Error("File resolves outside repository");
  return resolved;
}
async function workingBuffer(repo, file) {
  const target = await containedFile(repo, file),
    stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Select a regular file");
  if (stat.size > editorLimit)
    throw new Error("File exceeds editor limit of 2 MB");
  const buffer = await fs.readFile(target);
  if (buffer.length > editorLimit)
    throw new Error("File exceeds editor limit of 2 MB");
  return buffer;
}
async function revisionBuffer(repo, file, revision) {
  try {
    return (
      await run(
        "git",
        ["-C", repo, "show", `${ref(revision, "revision")}:${file}`],
        { encoding: "buffer", maxBuffer: editorLimit, timeout: 60000 },
      )
    ).stdout;
  } catch (e) {
    throw new Error(
      e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ? "File exceeds editor limit of 2 MB"
        : "File revision unavailable",
    );
  }
}
function blameLines(raw) {
  const result = [];
  let item;
  for (const row of raw.split("\n")) {
    const header = row.match(/^([0-9a-f]{40,64}) (\d+) (\d+)(?: (\d+))?$/);
    if (header) {
      item = {
        line: Number(header[3]),
        hash: header[1],
        author: "",
        email: "",
        date: "",
        summary: "",
        filename: "",
      };
      continue;
    }
    if (!item) continue;
    if (row.startsWith("\t")) {
      result.push(item);
      item = null;
      continue;
    }
    const space = row.indexOf(" "),
      key = row.slice(0, space),
      value = row.slice(space + 1);
    if (key === "author") item.author = value;
    else if (key === "author-mail") item.email = value.replace(/^<|>$/g, "");
    else if (key === "author-time")
      item.date = new Date(Number(value) * 1000).toISOString();
    else if (key === "summary") item.summary = value;
    else if (key === "filename") item.filename = value;
  }
  return result;
}
async function fileHistory(repo, file) {
  const marker = "BRANCHWORK-COMMIT",
    raw = await git(repo, [
      "log",
      "--follow",
      "--max-count=500",
      "--name-status",
      "-z",
      `--format=%x00${marker}%x00%H%x00%P%x00%s%x00%an%x00%aI%x00%D%x00`,
      "--",
      file,
    ]),
    fields = raw.split("\0"),
    commits = [];
  let currentPath = file,
    commit;
  for (let i = 0; i < fields.length;) {
    const token = fields[i++].replace(/^\n+/, "");
    if (!token) continue;
    if (token === marker) {
      const hash = fields[i++],
        parents = fields[i++],
        subject = fields[i++],
        author = fields[i++],
        date = fields[i++],
        refs = fields[i++];
      if (!/^[0-9a-f]{40,64}$/.test(hash))
        throw new Error("Invalid history record");
      commit = {
        hash,
        parents: parents.split(" ").filter(Boolean),
        subject,
        author,
        date,
        refs,
        path: currentPath,
      };
      commits.push(commit);
      continue;
    }
    if (!commit) throw new Error("Invalid history metadata");
    if (/^[RC]\d+$/.test(token)) {
      const oldPath = fields[i++],
        newPath = fields[i++];
      if (token[0] === "R" && newPath === currentPath) currentPath = oldPath;
    } else if (/^[AMDUTX]$/.test(token)) {
      i++;
    } else throw new Error("Invalid history status");
  }
  return commits;
}
export async function read(body) {
  const repo = path.resolve(ref(body.repo, "repository path"));
  await git(repo, ["rev-parse", "--git-dir"]);
  switch (body.action) {
    case "files": {
      const tracked = (await git(repo, ["ls-files", "--cached", "-z"]))
          .split("\0")
          .filter(Boolean),
        untracked = (
          await git(repo, ["ls-files", "--others", "--exclude-standard", "-z"])
        )
          .split("\0")
          .filter(Boolean),
        entries = new Map(
          tracked.map((file) => [file, { path: file, tracked: true }]),
        );
      for (const file of untracked)
        if (!entries.has(file))
          entries.set(file, { path: file, tracked: false });
      return {
        files: [...entries.values()].sort((a, b) =>
          a.path.localeCompare(b.path),
        ),
      };
    }
    case "file-content": {
      const file = paths([body.path])[0],
        buffer = body.revision
          ? await revisionBuffer(repo, file, body.revision)
          : await workingBuffer(repo, file);
      return {
        path: file,
        ...textFile(buffer),
        ...(body.revision ? { revision: body.revision } : {}),
      };
    }
    case "blame-lines": {
      const file = paths([body.path])[0];
      if (body.revision) await revisionBuffer(repo, file, body.revision);
      else await workingBuffer(repo, file);
      return {
        lines: blameLines(
          await git(repo, [
            "blame",
            "--line-porcelain",
            ...(body.revision ? [ref(body.revision)] : []),
            "--",
            file,
          ]),
        ),
      };
    }
    case "commit-detail": {
      const hash = (
          await git(repo, [
            "rev-parse",
            "--verify",
            `${ref(body.commit)}^{commit}`,
          ])
        ).trim(),
        raw = await git(repo, [
          "show",
          "--no-patch",
          "--format=%H%x00%P%x00%s%x00%B%x00%an%x00%ae%x00%aI%x00%D",
          hash,
        ]),
        [h, parents, subject, message, author, email, date, refs] = raw
          .trimEnd()
          .split("\0");
      const commit = {
        hash: h,
        parents: parents.split(" ").filter(Boolean),
        subject,
        message,
        author,
        email,
        date,
        refs,
      };
      const names = (
        await git(repo, [
          "diff-tree",
          "--root",
          "-m",
          "--first-parent",
          "--no-commit-id",
          "--name-only",
          "-r",
          "-z",
          hash,
          "--",
        ])
      )
        .split("\0")
        .filter(Boolean);
      const numstat = (
        await git(repo, [
          "show",
          "--format=",
          "--root",
          "--numstat",
          "--no-renames",
          "-z",
          hash,
          "--",
        ])
      )
        .split("\0")
        .filter(Boolean)
        .map((row) => {
          const match = row.match(/^([^\t]+)\t([^\t]+)\t([\s\S]*)$/);
          return match
            ? {
                path: match[3],
                added: match[1] === "-" ? null : Number(match[1]),
                deleted: match[2] === "-" ? null : Number(match[2]),
                binary: match[1] === "-",
              }
            : null;
        })
        .filter(Boolean);
      return {
        commit,
        stat: await git(repo, [
          "show",
          "--format=",
          "--root",
          "--stat",
          hash,
          "--",
        ]),
        files: [...new Set(names)].map((file) => ({
          path: file,
          ...numstat.find((item) => item.path === file),
        })),
        numstat,
      };
    }
    case "patch-lines": {
      const diff = await patchText(
        repo,
        paths([body.path])[0],
        Boolean(body.staged),
      );
      return { diff };
    }
    case "gitflow":
      return await flowConfig(repo);
    case "file-history":
      return { commits: await fileHistory(repo, paths([body.path])[0]) };
    case "compare": {
      const from = ref(body.from),
        to = ref(body.to);
      return {
        diff: await git(repo, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          from,
          to,
          "--",
          ...(body.path ? paths([body.path]) : []),
        ]),
        stat: await git(repo, [
          "diff",
          "--stat",
          from,
          to,
          "--",
          ...(body.path ? paths([body.path]) : []),
        ]),
      };
    }
    case "stash-show":
      return {
        diff: await git(repo, [
          "stash",
          "show",
          "--patch",
          "--include-untracked",
          ref(body.ref),
        ]),
      };
    case "reset-preview": {
      const target = (
        await git(repo, ["rev-parse", "--verify", `${ref(body.ref)}^{commit}`])
      ).trim();
      return {
        target,
        current: (await git(repo, ["rev-parse", "HEAD"])).trim(),
        stat: await git(repo, ["diff", "--stat", target, "HEAD", "--"]),
        files: status(await git(repo, ["status", "--porcelain=v1", "-z"])),
      };
    }
    case "gitignore": {
      let content = "";
      try {
        content = await fs.readFile(path.join(repo, ".gitignore"), "utf8");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      return { content };
    }
    case "image-version": {
      const file = paths([body.path])[0],
        extension = path.extname(file).toLowerCase(),
        mime = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".bmp": "image/bmp",
        }[extension];
      if (!mime) throw new Error("Only raster image files can be previewed");
      let buffer;
      if (body.version === "working") {
        const realRepo = await fs.realpath(repo),
          realFile = await fs.realpath(path.join(repo, file));
        if (!realFile.startsWith(realRepo + path.sep))
          throw new Error("File outside repository");
        const stat = await fs.stat(realFile);
        if (stat.size > 10 * 1024 * 1024)
          throw new Error("Image exceeds 10 MB");
        buffer = await fs.readFile(realFile);
      } else {
        const spec =
          body.version === "index"
            ? `:${file}`
            : `${ref(body.commit || body.version)}:${file}`;
        try {
          buffer = (
            await run("git", ["-C", repo, "show", spec], {
              encoding: "buffer",
              maxBuffer: 10 * 1024 * 1024,
              timeout: 60000,
            })
          ).stdout;
        } catch {
          throw new Error("Image version unavailable or exceeds 10 MB");
        }
      }
      return { mime, base64: buffer.toString("base64"), size: buffer.length };
    }
    case "state": {
      const limit = historyLimit(body.limit);
      const hasHead = Boolean(
        await optional(repo, ["rev-parse", "--verify", "HEAD"]),
      );
      const [branch, log, branchText, tagText, remoteText, stashText, raw, op] =
        await Promise.all([
          optional(repo, ["symbolic-ref", "--short", "HEAD"]),
          optional(repo, [
            "log",
            "--topo-order",
            "-n",
            String(limit),
            "--all",
            "--date=iso-strict",
            "--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D%x00",
            ...(hasHead ? ["HEAD"] : []),
          ]),
          git(repo, [
            "for-each-ref",
            "--format=%(refname:short)%00%(HEAD)%00%(refname)",
            "refs/heads",
            "refs/remotes",
          ]),
          git(repo, ["tag", "--list"]),
          git(repo, ["remote", "-v"]),
          optional(repo, ["stash", "list", "--format=%gd%x00%s"]),
          git(repo, ["status", "--porcelain=v1", "-z"]),
          operation(repo),
        ]);
      const commits = commitsFrom(log);
      const remotes = new Map();
      for (const line of remoteText.trim().split("\n").filter(Boolean)) {
        const m = line.match(/^(\S+)\s+(.*?)\s+\((fetch|push)\)$/);
        if (m) {
          const item = remotes.get(m[1]) || { name: m[1], fetch: "", push: "" };
          item[m[3]] = m[2];
          remotes.set(m[1], item);
        }
      }
      return {
        repo,
        branch:
          branch.trim() ||
          (await optional(repo, ["rev-parse", "--short", "HEAD"])).trim() ||
          "unborn",
        commits,
        historyLimit: limit,
        historyLimited: commits.length === limit,
        branches: branchText
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [name, current, r] = l.split("\0");
            return {
              name,
              current: current === "*",
              remote: r.startsWith("refs/remotes/"),
            };
          }),
        tags: tagText.trim().split("\n").filter(Boolean),
        remotes: [...remotes.values()],
        stash: stashText
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [ref, subject] = l.split("\0");
            return { ref, subject };
          }),
        files: status(raw),
        operation: op,
      };
    }
    case "history": {
      const limit = historyLimit(body.limit),
        offset = body.offset ?? 0;
      if (!Number.isInteger(offset) || offset < 0 || offset > 1000000)
        throw new Error("Invalid history offset");
      const commits = await history(repo, limit, offset);
      return {
        commits,
        historyLimit: limit,
        historyLimited: commits.length === limit,
        offset,
      };
    }
    case "rebase-plan": {
      const onto = ref(body.onto, "base reference");
      await git(repo, ["merge-base", "--is-ancestor", onto, "HEAD"]);
      if ((await git(repo, ["rev-list", "--merges", `${onto}..HEAD`])).trim())
        throw new Error(
          "Interactive rebase currently supports linear history only",
        );
      return {
        commits: commitsFrom(
          await git(repo, [
            "log",
            "--reverse",
            "--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D%x00",
            `${onto}..HEAD`,
          ]),
        ),
      };
    }
    case "config":
      return {
        name: (
          await optional(repo, ["config", "--local", "--get", "user.name"])
        ).trim(),
        email: (
          await optional(repo, ["config", "--local", "--get", "user.email"])
        ).trim(),
      };
    case "signing-config":
      return {
        enabled:
          (
            await optional(repo, [
              "config",
              "--local",
              "--get",
              "commit.gpgsign",
            ])
          ).trim() === "true",
        key: (
          await optional(repo, [
            "config",
            "--local",
            "--get",
            "user.signingkey",
          ])
        ).trim(),
      };
    case "worktrees": {
      const raw = await git(repo, ["worktree", "list", "--porcelain", "-z"]);
      const worktrees = [];
      let item;
      for (const field of raw.split("\0")) {
        if (!field) {
          item = null;
          continue;
        }
        const [key, ...rest] = field.split(" "),
          value = rest.join(" ");
        if (key === "worktree") {
          item = {
            path: value,
            head: "",
            branch: "",
            bare: false,
            locked: false,
            prunable: false,
          };
          worktrees.push(item);
        } else if (item) {
          if (key === "HEAD") item.head = value;
          else if (key === "branch")
            item.branch = value.replace(/^refs\/heads\//, "");
          else if (["bare", "locked", "prunable"].includes(key))
            item[key] = true;
        }
      }
      return { worktrees };
    }
    case "submodules":
      return {
        submodules: (await git(repo, ["submodule", "status"]))
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const m = line.match(/^(.)([0-9a-f]+) (.*?)(?: \([^)]*\))?$/);
            return m ? { status: m[1], hash: m[2], path: m[3] } : null;
          })
          .filter(Boolean),
      };
    case "lfs": {
      let installed = true;
      try {
        await git(repo, ["lfs", "version"]);
      } catch {
        installed = false;
      }
      return {
        installed,
        patterns: installed
          ? (await git(repo, ["lfs", "track"]))
              .split("\n")
              .filter((l) => /^\s+/.test(l))
              .map((l) => l.trim().replace(/ \(.*\)$/, ""))
          : [],
        files: installed
          ? (await git(repo, ["lfs", "ls-files"])).split("\n").filter(Boolean)
          : [],
      };
    }
    case "commit-files":
      return {
        files: [
          ...new Set(
            (
              await git(repo, [
                "diff-tree",
                "--root",
                "-m",
                "--first-parent",
                "--no-commit-id",
                "--name-only",
                "-r",
                "-z",
                ref(body.commit),
                "--",
              ])
            )
              .split("\0")
              .filter(Boolean),
          ),
        ].map((path) => ({ path, index: "M", worktree: " " })),
      };
    case "conflict": {
      const file = paths([body.path])[0];
      const files = (
        await git(repo, ["diff", "--name-only", "--diff-filter=U", "-z"])
      ).split("\0");
      if (!files.includes(file)) throw new Error("File is not conflicted");
      const base = await optional(repo, ["show", `:1:${file}`]),
        ours = await optional(repo, ["show", `:2:${file}`]),
        theirs = await optional(repo, ["show", `:3:${file}`]);
      let content = "";
      try {
        const realRepo = await fs.realpath(repo),
          realFile = await fs.realpath(path.join(repo, file));
        if (!realFile.startsWith(realRepo + path.sep))
          throw new Error("File outside repository");
        content = await fs.readFile(realFile, "utf8");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      return {
        base,
        ours,
        theirs,
        content,
        binary: [base, ours, theirs, content].some((text) =>
          text.includes("\0"),
        ),
      };
    }
    case "diff": {
      const args = body.commit
        ? [
            "show",
            "--format=",
            "--root",
            "--no-ext-diff",
            "--no-textconv",
            ref(body.commit),
          ]
        : ["diff", "--no-ext-diff", "--no-textconv"];
      if (body.staged && !body.commit) args.push("--cached");
      args.push("--");
      if (body.path) args.push(...paths([body.path]));
      let diff = await git(repo, args);
      if (!diff && body.path && !body.staged && !body.commit) {
        const files = status(
          await git(repo, ["status", "--porcelain=v1", "-z"]),
        );
        if (files.some((f) => f.path === body.path && f.index === "?")) {
          const content = await fs.readFile(
            path.join(repo, ...paths([body.path])),
            "utf8",
          );
          diff =
            `--- /dev/null\n+++ b/${body.path}\n` +
            content
              .split("\n")
              .map((l) => "+" + l)
              .join("\n");
        }
      }
      return { diff };
    }
    case "show":
      return {
        content: await git(repo, [
          "show",
          `${ref(body.commit)}:${paths([body.path])[0]}`,
        ]),
      };
    case "blame":
      return {
        content: await git(repo, ["blame", "--", ...paths([body.path])]),
      };
    case "reflog":
      return {
        entries: (
          await git(repo, ["reflog", "-n", "100", "--format=%H%x00%gd%x00%gs"])
        )
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [hash, selector, subject] = l.split("\0");
            return { hash, selector, subject };
          }),
      };
    case "conflicts":
      return {
        files: (
          await git(repo, ["diff", "--name-only", "--diff-filter=U", "-z"])
        )
          .split("\0")
          .filter(Boolean),
      };
    default:
      throw new Error("Unsupported read action");
  }
}
async function mutate(body) {
  const repo = path.resolve(ref(body.repo || body.path, "repository path"));
  let args;
  switch (body.action) {
    case "save-file": {
      const file = paths([body.path])[0];
      if (
        typeof body.content !== "string" ||
        Buffer.byteLength(body.content) > editorLimit ||
        body.content.includes("\0")
      )
        throw new Error("Editor requires UTF-8 text no larger than 2 MB");
      if (
        typeof body.expectedSha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(body.expectedSha256)
      )
        throw new Error("Expected SHA-256 required");
      const target = await containedFile(repo, file, body.allowNew === true);
      let handle;
      try {
        try {
          handle = await fs.open(
            target,
            fsConstants.O_RDWR | (fsConstants.O_NOFOLLOW || 0),
          );
        } catch (e) {
          if (e.code !== "ENOENT" || body.allowNew !== true) throw e;
          if (body.expectedSha256 !== sha256(Buffer.alloc(0)))
            throw new Error("File changed since opening; reload before saving");
          handle = await fs.open(target, "wx+");
        }
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > editorLimit)
          throw new Error("File cannot be edited");
        const original = await handle.readFile();
        if (sha256(original) !== body.expectedSha256)
          throw new Error("File changed since opening; reload before saving");
        if (textFile(original).binary)
          throw new Error("Binary files cannot be edited");
        const next = Buffer.from(body.content, "utf8");
        await handle.write(next, 0, next.length, 0);
        await handle.truncate(next.length);
        return { repo, path: file, sha256: sha256(next), output: "File saved" };
      } finally {
        await handle?.close();
      }
    }
    case "batch-cherry-pick": {
      if (
        !Array.isArray(body.refs) ||
        !body.refs.length ||
        body.refs.length > 100
      )
        throw new Error("Select 1 to 100 commits");
      if (await operation(repo))
        throw new Error("Finish the current operation first");
      const commits = [];
      for (const value of body.refs)
        commits.push(
          (
            await git(repo, ["rev-parse", "--verify", `${ref(value)}^{commit}`])
          ).trim(),
        );
      if (new Set(commits).size !== commits.length)
        throw new Error("Duplicate commits are not allowed");
      args = ["cherry-pick", ...commits];
      break;
    }
    case "stage-lines":
    case "unstage-lines":
    case "discard-lines": {
      const file = paths([body.path])[0],
        reverse = body.action !== "stage-lines",
        diff = await patchText(repo, file, body.action === "unstage-lines");
      return {
        repo,
        output: await applyPatch(
          repo,
          selectedPatch(diff, body.selectedLines, reverse),
          body.action === "discard-lines" ? "worktree" : "index",
          reverse,
        ),
      };
    }
    case "gitflow-config":
    case "gitflow-init": {
      const config = { ...(await flowConfig(repo)) };
      for (const key of Object.keys(config)) {
        if (body[key] !== undefined)
          config[key] = ref(body[key], `Gitflow ${key}`);
        await git(repo, [
          "check-ref-format",
          "--branch",
          config[key].endsWith("/") ? config[key] + "example" : config[key],
        ]);
      }
      if (config.main === config.develop)
        throw new Error("Main and develop branches must differ");
      for (const [key, value] of Object.entries(config))
        await git(repo, ["config", "--local", `branchwork.flow.${key}`, value]);
      if (body.action === "gitflow-init") {
        await git(repo, ["rev-parse", "--verify", "HEAD"]);
        for (const branch of [config.main, config.develop])
          if (
            !(await optional(repo, [
              "show-ref",
              "--verify",
              `refs/heads/${branch}`,
            ]))
          )
            await git(repo, ["branch", branch]);
        await git(repo, ["checkout", config.develop]);
      }
      return { repo, output: "Gitflow configured", ...config };
    }
    case "gitflow-start":
    case "gitflow-finish": {
      if (!["feature", "release", "hotfix"].includes(body.kind))
        throw new Error("Invalid Gitflow kind");
      const config = await flowConfig(repo),
        branch = config[body.kind] + ref(body.name, "flow name");
      await git(repo, ["check-ref-format", "--branch", branch]);
      if (
        (await git(repo, ["status", "--porcelain=v1", "-z"])).length ||
        (await operation(repo))
      )
        throw new Error(
          "Gitflow requires a clean working tree and no current operation",
        );
      if (body.action === "gitflow-start")
        return {
          repo,
          output: await git(repo, [
            "checkout",
            "-b",
            branch,
            body.kind === "hotfix" ? config.main : config.develop,
          ]),
        };
      await git(repo, ["show-ref", "--verify", `refs/heads/${branch}`]);
      const targets =
        body.kind === "feature"
          ? [config.develop]
          : [config.main, config.develop];
      for (const target of targets) {
        await git(repo, ["checkout", target]);
        await git(repo, ["merge", "--no-ff", "--no-edit", branch]);
        if (target === config.main) {
          const tag = ref(body.tag || body.name, "release tag");
          await git(repo, [
            "tag",
            "-a",
            tag,
            "-m",
            `${body.kind} ${body.name}`,
          ]);
        }
      }
      await git(repo, ["branch", "-d", branch]);
      return { repo, output: `Finished ${branch}` };
    }
    case "worktree-lock":
      args = ["worktree", "lock"];
      if (body.reason) args.push("--reason", String(body.reason));
      args.push("--", path.resolve(ref(body.path, "worktree path")));
      break;
    case "worktree-unlock":
      args = [
        "worktree",
        "unlock",
        "--",
        path.resolve(ref(body.path, "worktree path")),
      ];
      break;
    case "worktree-prune":
      args = ["worktree", "prune"];
      break;
    case "lfs-push":
      args = ["lfs", "push", ref(body.remote || "origin")];
      if (body.ref) args.push(ref(body.ref));
      break;
    case "lfs-prune":
      args = ["lfs", "prune"];
      break;
    case "lfs-checkout":
      args = ["lfs", "checkout"];
      if (body.path) args.push(...paths([body.path]));
      break;
    case "reset": {
      if (!["soft", "mixed", "hard"].includes(body.mode))
        throw new Error("Invalid reset mode");
      if (body.mode === "hard" && body.confirmed !== true)
        throw new Error("Hard reset requires explicit confirmation");
      args = ["reset", `--${body.mode}`, ref(body.ref)];
      break;
    }
    case "branch-upstream":
      args = [
        "branch",
        `--set-upstream-to=${ref(body.upstream)}`,
        ref(body.name),
      ];
      break;
    case "signing-config": {
      if (typeof body.enabled !== "boolean")
        throw new Error("Signing enabled flag required");
      await git(repo, [
        "config",
        "--local",
        "commit.gpgsign",
        String(body.enabled),
      ]);
      if (body.key)
        await git(repo, [
          "config",
          "--local",
          "user.signingkey",
          ref(body.key, "signing key"),
        ]);
      return { repo, output: "Commit signing configured" };
    }
    case "gitignore": {
      if (
        typeof body.content !== "string" ||
        Buffer.byteLength(body.content) > 1024 * 1024 ||
        body.content.includes("\0")
      )
        throw new Error("Valid ignore content required (maximum 1 MB)");
      const file = path.join(repo, ".gitignore");
      try {
        if ((await fs.lstat(file)).isSymbolicLink())
          throw new Error("Cannot edit symlinked ignore file");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await fs.writeFile(file, body.content);
      return { repo, output: "Repository ignore rules saved" };
    }
    case "tag-delete":
      args = ["tag", "-d", ref(body.name, "tag name")];
      break;
    case "stash-apply":
      args = ["stash", "apply"];
      if (body.ref) args.push(ref(body.ref));
      break;
    case "init":
      await fs.mkdir(repo, { recursive: true });
      return { output: await git(repo, ["init"]), repo };
    case "clone": {
      const target = path.resolve(ref(body.path, "destination"));
      const url = ref(body.url, "clone URL");
      try {
        const { stdout } = await run("git", ["clone", "--", url, target], {
          timeout: 120000,
          maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
        return { output: stdout, repo: target };
      } catch (e) {
        throw new Error((e.stderr || e.message).trim());
      }
    }
    case "stage":
      args = ["add", "--", ...paths(body.paths)];
      break;
    case "discard": {
      const selected = paths(body.paths);
      const tracked = new Set(
        (await git(repo, ["ls-files", "-z"])).split("\0"),
      );
      if (selected.some((p) => !tracked.has(p)))
        throw new Error("Discard only supports tracked files");
      args = ["restore", "--worktree", "--", ...selected];
      break;
    }
    case "config": {
      for (const [key, value] of [
        ["name", body.name],
        ["email", body.email],
      ]) {
        if (
          typeof value !== "string" ||
          !value.trim() ||
          /[\0\r\n]/.test(value)
        )
          throw new Error(`Invalid user ${key}`);
      }
      await git(repo, ["config", "--local", "user.name", body.name]);
      await git(repo, ["config", "--local", "user.email", body.email]);
      return { repo, output: "Repository identity saved" };
    }
    case "worktree-add":
      args = ["worktree", "add"];
      if (body.branch) args.push("-b", ref(body.branch, "branch name"));
      args.push("--", path.resolve(ref(body.path, "worktree path")));
      if (body.ref) args.push(ref(body.ref));
      break;
    case "worktree-remove":
      args = [
        "worktree",
        "remove",
        "--",
        path.resolve(ref(body.path, "worktree path")),
      ];
      break;
    case "submodule-add":
      args = [
        "submodule",
        "add",
        "--",
        ref(body.url, "submodule URL"),
        ...paths([body.path]),
      ];
      break;
    case "submodule-update":
      args = ["submodule", "update", "--init", "--recursive"];
      if (body.path) args.push("--", ...paths([body.path]));
      break;
    case "remote-add":
      args = [
        "remote",
        "add",
        ref(body.name, "remote name"),
        ref(body.url, "remote URL"),
      ];
      break;
    case "remote-remove":
      args = ["remote", "remove", ref(body.name, "remote name")];
      break;
    case "lfs-track":
    case "lfs-untrack":
      args = [
        "lfs",
        body.action === "lfs-track" ? "track" : "untrack",
        ref(body.pattern, "LFS pattern"),
      ];
      break;
    case "lfs-pull":
      args = ["lfs", "pull"];
      break;
    case "lfs-install":
      args = ["lfs", "install", "--local"];
      break;
    case "apply-patch":
      return {
        repo,
        output: await applyPatch(
          repo,
          body.patch,
          body.target || "index",
          Boolean(body.reverse),
        ),
      };
    case "interactive-rebase": {
      const onto = ref(body.onto, "base reference");
      await git(repo, ["merge-base", "--is-ancestor", onto, "HEAD"]);
      if (await operation(repo))
        throw new Error("Finish the current operation first");
      if ((await git(repo, ["status", "--porcelain=v1", "-z"])).length)
        throw new Error("Interactive rebase requires a clean working tree");
      const all = (await git(repo, ["rev-list", "--reverse", `${onto}..HEAD`]))
        .trim()
        .split("\n")
        .filter(Boolean);
      const merges = (
        await git(repo, ["rev-list", "--merges", `${onto}..HEAD`])
      ).trim();
      if (merges)
        throw new Error(
          "Interactive rebase currently supports linear history only",
        );
      if (
        !Array.isArray(body.steps) ||
        !body.steps.length ||
        body.steps.length !== all.length
      )
        throw new Error("Provide one step for every commit after the base");
      let kept = false;
      const seen = new Set();
      for (const step of body.steps) {
        if (
          !step ||
          !all.includes(step.hash) ||
          seen.has(step.hash) ||
          !["pick", "drop", "squash", "fixup", "reword", "edit"].includes(
            step.action,
          )
        )
          throw new Error("Steps must be a permutation of exact commit hashes");
        seen.add(step.hash);
        if (["squash", "fixup"].includes(step.action) && !kept)
          throw new Error("Squash/fixup requires an earlier picked commit");
        if (
          step.action === "reword" &&
          (typeof step.message !== "string" ||
            !step.message.trim() ||
            step.message.includes("\0"))
        )
          throw new Error("New message required for reword");
        if (["pick", "reword", "edit"].includes(step.action)) kept = true;
      }
      const temp = await rebaseEditor(repo);
      await fs.mkdir(temp, { recursive: true });
      const script = path.join(temp, "sequence.cjs"),
        editor = path.join(temp, "editor.cjs"),
        messages = path.join(temp, "messages.json"),
        todo = body.steps.map((s) => `${s.action} ${s.hash}`).join("\n") + "\n";
      await fs.writeFile(
        script,
        `require('node:fs').writeFileSync(process.argv[2],${JSON.stringify(todo)});`,
      );
      await fs.writeFile(
        messages,
        JSON.stringify(
          Object.fromEntries(
            body.steps
              .filter((s) => s.action === "reword")
              .map((s) => [s.hash, s.message]),
          ),
        ),
      );
      await fs.writeFile(
        editor,
        `const fs=require('node:fs');const p=${JSON.stringify(messages)};const file=process.argv[2];const done=require('node:child_process').execFileSync('git',['-C',${JSON.stringify(repo)},'rev-parse','--git-path','rebase-merge/done'],{encoding:'utf8'}).trim();const row=fs.readFileSync(require('node:path').resolve(${JSON.stringify(repo)},done),'utf8').trim().split('\\n').pop().split(/\\s+/);const hash=row[0]==='reword'?row[1]:'';const q=JSON.parse(fs.readFileSync(p));if(file.endsWith('COMMIT_EDITMSG')&&q[hash]){fs.writeFileSync(file,q[hash]+'\\n');delete q[hash];fs.writeFileSync(p,JSON.stringify(q));}`,
      );
      const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
      try {
        return {
          repo,
          output: await git(repo, ["rebase", "-i", onto], {
            GIT_SEQUENCE_EDITOR: `${quote(process.execPath)} ${quote(script)}`,
            GIT_EDITOR: `${quote(process.execPath)} ${quote(editor)}`,
            ELECTRON_RUN_AS_NODE: "1",
          }),
        };
      } finally {
        if (!(await operation(repo)))
          await fs.rm(temp, { recursive: true, force: true });
      }
    }
    case "resolve-conflict": {
      const file = paths([body.path])[0];
      const conflicts = (
        await git(repo, ["diff", "--name-only", "--diff-filter=U", "-z"])
      ).split("\0");
      if (!conflicts.includes(file)) throw new Error("File is not conflicted");
      if (body.choice === "delete") {
        return { repo, output: await git(repo, ["rm", "--", file]) };
      }
      if (["ours", "theirs"].includes(body.choice)) {
        const stage = body.choice === "ours" ? 2 : 3;
        const exists = await optional(repo, [
          "rev-parse",
          "--verify",
          `:${stage}:${file}`,
        ]);
        if (!exists)
          return { repo, output: await git(repo, ["rm", "--", file]) };
        await git(repo, ["checkout", `--${body.choice}`, "--", file]);
        return { repo, output: await git(repo, ["add", "--", file]) };
      }
      if (typeof body.content !== "string")
        throw new Error("Resolved file content required");
      const realRepo = await fs.realpath(repo),
        realFile = await fs.realpath(path.join(repo, file));
      if (!realFile.startsWith(realRepo + path.sep))
        throw new Error("File resolves outside repository");
      await fs.writeFile(realFile, body.content);
      args = ["add", "--", file];
      break;
    }
    case "unstage":
      args = (await optional(repo, ["rev-parse", "--verify", "HEAD"]))
        ? ["restore", "--staged", "--", ...paths(body.paths)]
        : ["rm", "--cached", "--", ...paths(body.paths)];
      break;
    case "commit":
      if (typeof body.message !== "string" || !body.message.trim())
        throw new Error("Commit message required");
      args = ["commit", "-m", body.message];
      if (body.amend) args.push("--amend");
      break;
    case "branch":
      args = ["branch", ref(body.name, "branch name")];
      if (body.start) args.push(ref(body.start));
      break;
    case "branch-delete":
      args = ["branch", "-d", ref(body.name, "branch name")];
      break;
    case "branch-rename":
      args = [
        "branch",
        "-m",
        ref(body.name, "branch name"),
        ref(body.newName, "new branch name"),
      ];
      break;
    case "checkout":
      args = ["checkout", ref(body.ref)];
      break;
    case "merge":
    case "rebase":
    case "cherry-pick":
    case "revert":
      args = [body.action, ref(body.ref)];
      if (body.action === "revert") args.splice(1, 0, "--no-edit");
      if (body.action === "rebase" && body.preserveMerges === true)
        args.splice(1, 0, "--rebase-merges");
      break;
    case "stash":
      args = ["stash", "push"];
      if (body.message) args.push("-m", String(body.message));
      if (body.includeUntracked) args.push("--include-untracked");
      break;
    case "stash-pop":
    case "stash-drop":
      args = ["stash", body.action === "stash-pop" ? "pop" : "drop"];
      if (body.ref) args.push(ref(body.ref));
      break;
    case "tag":
      args = ["tag"];
      if (body.annotated || body.message)
        args.push("-a", "-m", String(body.message || body.name));
      args.push(ref(body.name, "tag name"));
      if (body.ref) args.push(ref(body.ref));
      break;
    case "fetch":
      args = ["fetch", "--all", "--prune"];
      break;
    case "pull": {
      const policy = body.policy || "ff-only";
      if (!["ff-only", "merge", "rebase"].includes(policy))
        throw new Error("Invalid pull policy");
      args = [
        "pull",
        policy === "merge"
          ? "--no-rebase"
          : policy === "rebase"
            ? "--rebase"
            : "--ff-only",
      ];
      if (body.remote) args.push(ref(body.remote));
      if (body.branch) {
        if (!body.remote) throw new Error("Select remote for branch");
        args.push(ref(body.branch));
      }
      break;
    }
    case "push":
      args = ["push"];
      if (body.upstream) args.push("--set-upstream");
      if (body.forceWithLease) {
        if (body.confirmed !== true)
          throw new Error("Force with lease requires explicit confirmation");
        args.push("--force-with-lease");
      }
      if (body.remote) args.push(ref(body.remote));
      if (body.branch) {
        if (!body.remote) throw new Error("Select remote for branch");
        args.push(ref(body.branch));
      }
      break;
    case "abort":
    case "continue": {
      const op = await operation(repo);
      if (!op) throw new Error("No operation in progress");
      const temp = await rebaseEditor(repo),
        editor = path.join(temp, "editor.cjs");
      const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
      let env = {};
      try {
        await fs.access(editor);
        env = {
          GIT_EDITOR: `${quote(process.execPath)} ${quote(editor)}`,
          ELECTRON_RUN_AS_NODE: "1",
        };
      } catch {}
      try {
        return { repo, output: await git(repo, [op, `--${body.action}`], env) };
      } finally {
        if (!(await operation(repo)))
          await fs.rm(temp, { recursive: true, force: true });
      }
    }
    default:
      throw new Error("Unsupported write action");
  }
  return { output: await git(repo, args), repo };
}
export async function write(body) {
  const key = path.resolve(ref(body.repo || body.path, "repository path"));
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => mutate(body));
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}
export function createServer(options = {}) {
  const settings =
    options.settings || createSettingsStore({ directory: options.settingsDir });
  let services;
  const getServices = () =>
    (services ||= import("./integrations.mjs").then(({ createServices }) =>
      createServices({ read, write, settings, fetchImpl: options.fetchImpl }),
    ));
  const server = http.createServer(async (req, res) => {
    const json = (code, data) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const host = req.headers.host;
      const localPort = req.socket.localPort;
      if (
        ![
          `localhost:${localPort}`,
          `127.0.0.1:${localPort}`,
          `[::1]:${localPort}`,
        ].includes(host)
      )
        return json(403, { error: "Invalid local host" });
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/health")
        return json(200, { ok: true });
      if (
        req.method === "POST" &&
        ["/api/read", "/api/write", "/api/service"].includes(url.pathname)
      ) {
        // A local web page must not be able to send Git mutations across origins.
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}`
        )
          return json(403, { error: "Cross-origin request denied" });
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return json(415, { error: "JSON content type required" });
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 1024 * 1024) throw new Error("Request too large");
        }
        const body = JSON.parse(raw);
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error("JSON object required");
        const result =
          url.pathname === "/api/read"
            ? await read(body)
            : url.pathname === "/api/write"
              ? await write(body)
              : await (await getServices()).handle(body);
        return json(200, result);
      }
      if (req.method !== "GET")
        return json(405, { error: "Method not allowed" });
      const relative =
        decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const filename = path.resolve(root, "public", relative);
      if (!filename.startsWith(path.join(root, "public") + path.sep))
        return json(403, { error: "Invalid path" });
      const content = await fs.readFile(filename);
      const types = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "text/javascript",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
      res.writeHead(200, {
        "Content-Type":
          types[path.extname(filename)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'self'",
      });
      res.end(content);
    } catch (e) {
      json(e.code === "ENOENT" ? 404 : 400, { error: e.message });
    }
  });
  server.on("close", () => {
    services?.then((service) => service.close?.()).catch(() => {});
  });
  return server;
}
if (
  process.env.BRANCHWORK_EMBEDDED !== "1" &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  createServer().listen(Number(process.env.PORT) || 4317, "127.0.0.1", () =>
    console.log(
      `Git client: http://127.0.0.1:${Number(process.env.PORT) || 4317}`,
    ),
  );
