import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'app');
const hash = data => createHash('sha256').update(data).digest('hex');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const strings = JSON.parse(await fs.readFile(path.join(root, 'src/strings.json'), 'utf8'));
const bindings = JSON.parse(await fs.readFile(path.join(root, 'src/keyBindings/shared.json'), 'utf8'));
const observed = [];
function walk(value, keys = []) {
  for (const [key, v] of Object.entries(value)) {
    const route = [...keys, key];
    if (v && typeof v === 'object') walk(v, route);
    else if (/graph|commit|branch|stash|merge|rebase|cherry|revert|blame|reflog|worktree|submodule|pullrequest|workspace|integration|gitflow|lfs|hunk|stage|patch/i.test(key)) {
      observed.push({ location: 'src/strings.json#/' + route.join('/'), key, label: v });
    }
  }
}
walk(strings);
const files = ['package.json', 'src/strings.json', 'src/keyBindings/shared.json', 'src/css/styles.css', 'src/main/static/main.bundle.js', 'src/render/static/entryPoints/main/render.bundle.js'];
const artifacts = [];
for (const relative of files) {
  const data = await fs.readFile(path.join(root, relative));
  artifacts.push({ path: relative, bytes: data.length, sha256: hash(data) });
}
const result = {
  target: { name: manifest.name, version: manifest.version, main: manifest.main },
  observation_type: 'static-files',
  artifacts,
  architecture: { renderer: 'React 17.0.2', state: 'Redux + redux-saga', git: '@axosoft/nodegit and bundled Git CLI', processes: 'main, renderer, request-handler, worker', source: 'package.json and shipped entrypoint paths' },
  dependencies: manifest.dependencies,
  keybindings: bindings,
  feature_labels: observed,
  limitations: ['Labels establish shipped UI vocabulary, not runtime behavior or reachability.', 'Minified bundles and native modules need focused analysis and runtime corroboration.', 'Remote account services are not reproduced by the local installer.', 'No proprietary application code or assets are included in Branchwork runtime.']
};
await fs.writeFile(path.join(here, 'artifact-inventory.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ version: manifest.version, artifacts: artifacts.length, featureLabels: observed.length, output: path.join(here, 'artifact-inventory.json') }));
