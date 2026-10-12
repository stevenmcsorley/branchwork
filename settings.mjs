import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const defaults = () => ({
  ai: {
    enabled: false,
    mode: "cloud",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    apiKey: "",
    mcp: {
      transport: "stdio",
      command: "",
      args: [],
      url: "",
      tool: "",
      argumentsTemplate: {
        prompt: "{{prompt}}\n\nRepository context:\n{{context}}",
      },
    },
  },
  provider: {
    type: "github",
    baseUrl: "https://api.github.com",
    owner: "",
    repository: "",
    organization: "",
    project: "",
    username: "",
    token: "",
  },
});
const isObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const secretKey = (key) =>
  /^(apiKey|token|password|authorization|bearerToken|mcpToken)$/i.test(key);
function merge(target, change) {
  for (const [key, value] of Object.entries(change)) {
    if (
      [
        "__proto__",
        "constructor",
        "prototype",
        "clearKey",
        "clearToken",
      ].includes(key)
    )
      continue;
    if (secretKey(key) && value === "") continue;
    if (isObject(value)) {
      if (!isObject(target[key])) target[key] = {};
      merge(target[key], value);
    } else target[key] = structuredClone(value);
  }
  if (change.clearKey === true) target.apiKey = "";
  if (change.clearToken === true) target.token = "";
}
function splitSecrets(value, secrets = {}, prefix = []) {
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (secretKey(key)) {
      if (item) secrets[[...prefix, key].join(".")] = item;
    } else if (isObject(item))
      safe[key] = splitSecrets(item, secrets, [...prefix, key]).safe;
    else safe[key] = item;
  }
  return { safe, secrets };
}
function redact(value) {
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (secretKey(key))
      result["has" + key[0].toUpperCase() + key.slice(1)] = Boolean(item);
    else result[key] = isObject(item) ? redact(item) : structuredClone(item);
  }
  return result;
}
export function createSettingsStore(options = {}) {
  const directory =
    options.directory ||
    process.env.BRANCHWORK_SETTINGS_DIR ||
    path.join(os.homedir(), ".config", "branchwork");
  const filename = path.join(directory, "settings.json");
  const encrypted =
    typeof options.encrypt === "function" &&
    typeof options.decrypt === "function";
  let cached;
  let retainedEncryptedSecrets;
  let writeQueue = Promise.resolve();
  async function load() {
    if (!cached) {
      cached = defaults();
      try {
        const saved = JSON.parse(await fs.readFile(filename, "utf8"));
        if (saved.version !== 1 || !isObject(saved.config))
          throw Error("Unsupported Branchwork settings format");
        merge(cached, saved.config);
        retainedEncryptedSecrets = saved.encryptedSecrets;
        if (saved.encryptedSecrets && encrypted) {
          const secrets = JSON.parse(
            await options.decrypt(saved.encryptedSecrets),
          );
          for (const [route, value] of Object.entries(secrets)) {
            const keys = route.split(".");
            if (
              keys.some((key) =>
                ["__proto__", "constructor", "prototype"].includes(key),
              )
            )
              continue;
            let obj = cached;
            for (const key of keys.slice(0, -1)) obj = obj[key] ||= {};
            obj[keys.at(-1)] = value;
          }
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          cached = undefined;
          throw new Error(
            "Unable to read Branchwork settings: " + error.message,
          );
        }
      }
      if (process.env.BRANCHWORK_AI_API_KEY)
        cached.ai.apiKey = process.env.BRANCHWORK_AI_API_KEY;
      if (process.env.BRANCHWORK_PROVIDER_TOKEN)
        cached.provider.token = process.env.BRANCHWORK_PROVIDER_TOKEN;
    }
    return structuredClone(cached);
  }
  async function save() {
    const { safe, secrets } = splitSecrets(cached);
    let encryptedSecrets = encrypted ? undefined : retainedEncryptedSecrets;
    if (encrypted && Object.keys(secrets).length)
      encryptedSecrets = await options.encrypt(JSON.stringify(secrets));
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temp = path.join(directory, "settings-" + randomUUID() + ".tmp");
    try {
      await fs.writeFile(
        temp,
        JSON.stringify(
          {
            version: 1,
            config: safe,
            ...(encryptedSecrets ? { encryptedSecrets } : {}),
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      await fs.rename(temp, filename);
      await fs.chmod(filename, 0o600);
      retainedEncryptedSecrets = encryptedSecrets;
    } finally {
      await fs.unlink(temp).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  return {
    load,
    async update(section, change) {
      if (!["ai", "provider"].includes(section) || !isObject(change))
        throw Error("Invalid settings section");
      const next = writeQueue
        .catch(() => {})
        .then(async () => {
          await load();
          const previous = structuredClone(cached);
          merge(cached[section], change);
          try {
            await save();
          } catch (error) {
            cached = previous;
            throw error;
          }
          return load();
        });
      writeQueue = next;
      return next;
    },
    async public() {
      return {
        ...redact(await load()),
        secretStorage: encrypted ? "encrypted" : "session",
      };
    },
  };
}
