import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./build-runtime.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Builds the self-contained Electron app directory shared by every desktop package.
export async function stageApp(app) {
  const pkg = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  await fs.mkdir(app, { recursive: true });
  await bundle("server.mjs", path.join(app, "server.mjs"));
  await fs.cp(path.join(root, "public"), path.join(app, "public"), {
    recursive: true,
  });
  await fs.cp(path.join(root, "desktop"), path.join(app, "desktop"), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(root, "settings.mjs"),
    path.join(app, "settings.mjs"),
  );
  await fs.writeFile(
    path.join(app, "package.json"),
    JSON.stringify(
      {
        name: "branchwork",
        productName: "Branchwork",
        version: pkg.version,
        description: "Local Git workbench with optional AI and MCP",
        author: "Branchwork contributors",
        license: pkg.license,
        type: "module",
        main: "desktop/main.cjs",
      },
      null,
      2,
    ),
  );
  return app;
}
