import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const banner =
  "import {createRequire as __branchworkCreateRequire} from 'node:module'; const require=__branchworkCreateRequire(import.meta.url); process.env.BRANCHWORK_EMBEDDED='1';";
export async function bundle(entry, output) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: banner },
    legalComments: "linked",
    sourcemap: false,
    logLevel: "warning",
  });
}
export async function buildRuntimes() {
  const runtime = path.join(root, "vscode/runtime");
  await bundle("server.mjs", path.join(runtime, "runtime.mjs"));
  await fs.cp(path.join(root, "public"), path.join(runtime, "public"), {
    recursive: true,
  });
  await bundle(
    "mcp-server.mjs",
    path.join(root, "dist/mcp/branchwork-mcp.mjs"),
  );
  return runtime;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(await buildRuntimes());
}
