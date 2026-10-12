import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const run = promisify(execFile);
const repo = await fs.mkdtemp(path.join(os.tmpdir(), "branchwork-demo-"));
const git = (...args) => run("git", ["-C", repo, ...args]);
await git("init", "-b", "main");
await git("config", "user.name", "Branchwork Demo");
await git("config", "user.email", "demo@example.invalid");
await fs.writeFile(
  path.join(repo, "README.md"),
  "# Sample workspace\n\nA disposable repository for exploring Branchwork.\n",
);
await git("add", ".");
await git("commit", "-m", "Initialize the workspace");
await fs.writeFile(
  path.join(repo, "app.js"),
  `// A real, disposable Git history for exploring Branchwork.
export const greeting = 'Hello, world';

export function describeCommit(commit) {
  return {
    hash: commit.hash.slice(0, 8),
    message: commit.subject,
    author: commit.author,
    branches: commit.refs.split(', ').filter(Boolean)
  };
}

export function groupByAuthor(commits) {
  const groups = new Map();
  for (const commit of commits) {
    const current = groups.get(commit.author) || [];
    current.push(describeCommit(commit));
    groups.set(commit.author, current);
  }
  return groups;
}

export function filterHistory(commits, query) {
  const needle = query.trim().toLowerCase();
  return commits.filter(commit =>
    commit.subject.toLowerCase().includes(needle) ||
    commit.author.toLowerCase().includes(needle)
  );
}
`,
);
await git("add", ".");
await git("commit", "-m", "Add the application entrypoint");
await git("switch", "-c", "feature/search");
await fs.writeFile(
  path.join(repo, "search.js"),
  "export const search = (items, query) => items.filter(item => item.includes(query));\n",
);
await git("add", ".");
await git("commit", "-m", "Implement search filtering");
await git("switch", "main");
await fs.writeFile(
  path.join(repo, "theme.css"),
  ":root { color-scheme: dark; }\n",
);
await git("add", ".");
await git("commit", "-m", "Set up the dark theme");
await git("merge", "--no-ff", "feature/search", "-m", "Merge search into main");
await git("tag", "v0.1.0");
await git("switch", "-c", "feature/settings");
await fs.writeFile(path.join(repo, "settings.json"), '{"theme":"dark"}\n');
await git("add", ".");
await git("commit", "-m", "Add workspace settings");
await git("switch", "main");
await fs.appendFile(
  path.join(repo, "README.md"),
  "\nTry staging this change and making a commit.\n",
);
await fs.writeFile(
  path.join(repo, "notes.txt"),
  "An untracked file for staging tests.\n",
);
console.log(repo);
