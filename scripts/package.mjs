import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await fs.mkdir(path.join(root, "dist"), { recursive: true });
const output = path.join(root, "dist", "branchwork-source.tar.gz");
await promisify(execFile)("tar", [
  "-czf",
  output,
  "-C",
  root,
  "--exclude=vscode/runtime",
  "--exclude=vscode/*.vsix",
  "--transform=s,^,branchwork/,",
  "package.json",
  "package-lock.json",
  "server.mjs",
  "settings.mjs",
  "integrations.mjs",
  "hosting.mjs",
  "mcp-server.mjs",
  "plugin.json",
  "mcp.json",
  "public",
  "desktop",
  "vscode",
  "scripts",
  "tests",
  "docs",
  ".github",
  "README.md",
  "TESTING.md",
  "LICENSE",
  ".gitignore",
  "research/FINDINGS.md",
]);
console.log(output);
