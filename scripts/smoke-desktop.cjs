// Boots a packaged app's bundled server with the shipped Electron binary (ELECTRON_RUN_AS_NODE=1)
// and checks that it serves the UI.
const path = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const app = path.resolve(process.argv[2]);
  const { createServer } = await import(
    pathToFileURL(path.join(app, "server.mjs")).href
  );
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(origin + "/");
    if (page.status !== 200 || !(await page.text()).includes("Branchwork"))
      throw Error(`UI not served (HTTP ${page.status})`);
    console.log("BRANCHWORK_SMOKE_OK", process.platform, process.arch);
  } finally {
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
