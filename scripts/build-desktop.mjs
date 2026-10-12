import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { build, Platform } from "electron-builder";
import { dependencyNotices } from "./licenses.mjs";
import { stageApp } from "./stage-app.mjs";
const run = promisify(execFile),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Windows and macOS installers. Build each on its own OS (see .github/workflows/release.yml).
const platform =
  process.env.BRANCHWORK_DESKTOP_TARGET ||
  { win32: "windows", darwin: "macos" }[process.platform];
if (!platform)
  throw Error(
    "Run this on Windows or macOS. Linux packages come from scripts/build-release.mjs.",
  );
const stage = path.join(root, "dist", "app-stage"),
  output = path.join(root, "dist", "desktop");
await fs.rm(stage, { recursive: true, force: true });
await fs.rm(output, { recursive: true, force: true });
await stageApp(stage);
const notices = path.join(root, "dist", "THIRD_PARTY_LICENSES.txt");
await fs.writeFile(notices, await dependencyNotices(root));
const electronVersion = JSON.parse(
  await fs.readFile(
    path.join(root, "node_modules/electron/package.json"),
    "utf8",
  ),
).version;
// Without a Developer ID certificate (CSC_LINK), ad-hoc sign so Apple Silicon accepts the bundle.
const signed = Boolean(process.env.CSC_LINK);
await build({
  targets:
    platform === "windows"
      ? Platform.WINDOWS.createTarget()
      : Platform.MAC.createTarget(),
  publish: "never",
  config: {
    appId: "io.github.stevenmcsorley.branchwork",
    productName: "Branchwork",
    copyright: "Copyright (c) 2026 Branchwork contributors",
    electronVersion,
    asar: false,
    npmRebuild: false,
    directories: { app: stage, output, buildResources: "build" },
    files: ["**/*", "!node_modules{,/**}"],
    extraResources: [
      { from: path.join(root, "LICENSE"), to: "LICENSE" },
      { from: notices, to: "THIRD_PARTY_LICENSES.txt" },
    ],
    icon: path.join(root, "build", "icon.png"),
    win: {
      target: [
        { target: "nsis", arch: ["x64"] },
        { target: "zip", arch: ["x64"] },
      ],
      artifactName: "branchwork-${version}-windows-${arch}.${ext}",
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      artifactName: "branchwork-${version}-windows-${arch}-setup.${ext}",
    },
    mac: {
      target: [
        { target: "dmg", arch: ["arm64", "x64"] },
        { target: "zip", arch: ["arm64", "x64"] },
      ],
      category: "public.app-category.developer-tools",
      artifactName: "branchwork-${version}-macos-${arch}.${ext}",
      ...(signed ? { hardenedRuntime: true } : { identity: null }),
    },
    dmg: { artifactName: "branchwork-${version}-macos-${arch}.${ext}" },
    afterPack: async (context) => {
      if (context.electronPlatformName !== "darwin" || signed) return;
      const bundle = path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
      );
      await run("codesign", ["--force", "--deep", "--sign", "-", bundle]);
    },
  },
});
const names = (await fs.readdir(output)).filter((name) =>
  /\.(exe|dmg|zip)$/.test(name),
);
const lines = [];
for (const name of names) {
  const bytes = await fs.readFile(path.join(output, name));
  lines.push(createHash("sha256").update(bytes).digest("hex") + "  " + name);
}
await fs.writeFile(
  path.join(output, `SHA256SUMS-${platform}.txt`),
  lines.join("\n") + "\n",
);
console.log(names.join("\n"));
