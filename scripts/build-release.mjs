import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { buildRuntimes } from "./build-runtime.mjs";
import { stageApp } from "./stage-app.mjs";
import { dependencyNotices } from "./licenses.mjs";
const run = promisify(execFile),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  ),
  version = pkg.version;
if (process.platform !== "linux" || process.arch !== "x64")
  throw Error(
    "This release script builds Linux x64 packages. Build other desktop targets on their own host.",
  );
const dist = path.join(root, "dist");
await fs.mkdir(dist, { recursive: true });
await buildRuntimes();
const notices = await dependencyNotices(root);
await fs.writeFile(path.join(dist, "THIRD_PARTY_LICENSES.txt"), notices);
await fs.copyFile(
  path.join(root, "LICENSE"),
  path.join(root, "vscode", "LICENSE"),
);
await fs.writeFile(
  path.join(root, "vscode", "runtime", "THIRD_PARTY_LICENSES.txt"),
  notices,
);
const portable = path.join(dist, `branchwork-${version}-linux-x64`),
  app = path.join(portable, "app");
await fs.mkdir(app, { recursive: true });
await fs.cp(
  path.join(root, "node_modules/electron/dist"),
  path.join(portable, "electron"),
  { recursive: true },
);
await stageApp(app);
await fs.copyFile(path.join(root, "LICENSE"), path.join(portable, "LICENSE"));
await fs.writeFile(path.join(portable, "THIRD_PARTY_LICENSES.txt"), notices);
await fs.writeFile(
  path.join(portable, "branchwork"),
  '#!/bin/sh\nbranchwork_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$branchwork_dir/electron/electron" "$branchwork_dir/app" "$@"\n',
  { mode: 0o755 },
);
await fs.writeFile(
  path.join(portable, "INSTALL.txt"),
  `Branchwork ${version}\nRequires system Git and GTK/NSS libraries.\nRun ./branchwork.\nIf Ubuntu blocks unprivileged sandbox startup, use ./branchwork --no-sandbox, or install the DEB (which installs the sandbox helper with its required ownership).\nThe flag only changes this application's process sandbox. See the source README for details.\n`,
);
await fs.cp(
  path.join(root, "vscode/media/branch.svg"),
  path.join(portable, "branchwork.svg"),
);
await run("tar", [
  "-czf",
  path.join(dist, `branchwork-${version}-linux-x64.tar.gz`),
  "-C",
  dist,
  path.basename(portable),
]);
const deb = path.join(dist, "deb-stage"),
  installed = path.join(deb, "opt", "branchwork");
await fs.mkdir(path.join(deb, "DEBIAN"), { recursive: true });
await fs.cp(portable, installed, { recursive: true });
await fs.chmod(path.join(installed, "electron", "chrome-sandbox"), 0o4755);
await fs.writeFile(
  path.join(deb, "DEBIAN", "control"),
  `Package: branchwork\nVersion: ${version}\nArchitecture: amd64\nMaintainer: Branchwork contributors\nSection: devel\nPriority: optional\nDepends: git, libgtk-3-0, libnss3, libxss1, libxtst6, libgbm1, libasound2t64 | libasound2, libx11-xcb1, libdrm2, libatk-bridge2.0-0\nDescription: Local Git workbench with optional AI and MCP\n Commit graph, editor blame, advanced local workflows and configurable integrations.\n`,
);
await fs.mkdir(path.join(deb, "usr/share/applications"), { recursive: true });
await fs.writeFile(
  path.join(deb, "usr/share/applications", "branchwork.desktop"),
  "[Desktop Entry]\nType=Application\nName=Branchwork\nComment=Local Git workbench\nExec=/opt/branchwork/branchwork\nIcon=/opt/branchwork/branchwork.svg\nTerminal=false\nCategories=Development;RevisionControl;\n",
);
await run(
  "dpkg-deb",
  [
    "--root-owner-group",
    "--build",
    deb,
    path.join(dist, `branchwork_${version}_amd64.deb`),
  ],
  { maxBuffer: 1024 * 1024 },
);
await fs.copyFile(
  path.join(root, "LICENSE"),
  path.join(dist, "mcp", "LICENSE"),
);
await fs.writeFile(path.join(dist, "mcp", "THIRD_PARTY_LICENSES.txt"), notices);
await run("tar", [
  "-czf",
  path.join(dist, `branchwork-mcp-${version}.tar.gz`),
  "-C",
  dist,
  "mcp",
]);
console.log(
  "Linux portable, DEB, MCP bundle, and VS Code runtime built. Package the VSIX with vsce next.",
);
export async function checksums() {
  const names = (await fs.readdir(dist)).filter((name) =>
    /\.(deb|vsix|tar\.gz)$/.test(name),
  );
  const lines = [];
  for (const name of names) {
    const bytes = await fs.readFile(path.join(dist, name));
    lines.push(createHash("sha256").update(bytes).digest("hex") + "  " + name);
  }
  await fs.writeFile(path.join(dist, "SHA256SUMS"), lines.join("\n") + "\n");
}
await checksums();
