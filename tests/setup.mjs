// Shared test environment so results don't depend on the host's Git or temp-directory setup.
import fs from "node:fs";
import os from "node:os";
// Git reports canonical paths (macOS /private/var, Windows long names); give tests the same form.
const temp = fs.realpathSync.native(os.tmpdir());
for (const key of process.platform === "win32" ? ["TEMP", "TMP"] : ["TMPDIR"])
  process.env[key] = temp;
// Git for Windows defaults to core.autocrlf=true, which rewrites checked-out files with CRLF.
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "core.autocrlf";
process.env.GIT_CONFIG_VALUE_0 = "false";
