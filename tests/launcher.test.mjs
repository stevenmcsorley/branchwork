import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

test(
  "portable Linux launcher chooses sandbox flags from helper permissions",
  { skip: process.platform !== "linux" },
  async (t) => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "branchwork portable launcher-"),
    );
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const electronDir = path.join(dir, "electron"),
      appDir = path.join(dir, "app"),
      launcher = path.join(dir, "branchwork"),
      helper = path.join(electronDir, "chrome-sandbox"),
      electron = path.join(electronDir, "electron");
    await fs.mkdir(electronDir);
    await fs.mkdir(appDir);
    await fs.writeFile(helper, "", { mode: 0o755 });
    await fs.writeFile(
      electron,
      '#!/bin/sh\nprintf "%s\\n" "$@"\n',
      { mode: 0o755 },
    );
    await fs.writeFile(
      launcher,
      await fs.readFile(
        new URL("../scripts/portable-linux-launcher.sh", import.meta.url),
        "utf8",
      ),
      { mode: 0o755 },
    );

    const unprivileged = await execFileAsync(launcher, ["--test-option"], {
      encoding: "utf8",
    });
    assert.deepEqual(unprivileged.stdout.trim().split("\n"), [
      "--no-sandbox",
      "--test-option",
      appDir,
    ]);

    const fakeBin = path.join(dir, "bin");
    await fs.mkdir(fakeBin);
    await fs.writeFile(
      path.join(fakeBin, "stat"),
      '#!/bin/sh\nprintf "0:4755\\n"\n',
      { mode: 0o755 },
    );
    const privileged = await execFileAsync(launcher, ["--test-option"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    });
    assert.deepEqual(privileged.stdout.trim().split("\n"), [
      "--test-option",
      appDir,
    ]);
  },
);
