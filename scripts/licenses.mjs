import fs from "node:fs/promises";
import path from "node:path";
export async function dependencyNotices(root) {
  const lock = JSON.parse(
    await fs.readFile(path.join(root, "package-lock.json"), "utf8"),
  );
  const notices = [
    "Branchwork runtime dependency notices",
    "Electron and Chromium notices are also included alongside the desktop runtime.",
  ];
  for (const [relative, metadata] of Object.entries(lock.packages || {})) {
    if (!relative || metadata.dev) continue;
    const location = path.join(root, relative);
    let manifest;
    try {
      manifest = JSON.parse(
        await fs.readFile(path.join(location, "package.json"), "utf8"),
      );
    } catch {
      continue;
    }
    notices.push(
      `\n${manifest.name} ${manifest.version} (${metadata.license || manifest.license || "see package license"})`,
    );
    const files = await fs.readdir(location);
    for (const file of files.filter((name) =>
      /^(licen[sc]e|copying|notice)(\.|$)/i.test(name),
    )) {
      try {
        const stat = await fs.stat(path.join(location, file));
        if (stat.isFile() && stat.size < 500000)
          notices.push(await fs.readFile(path.join(location, file), "utf8"));
      } catch {}
    }
  }
  return notices.join("\n") + "\n";
}
