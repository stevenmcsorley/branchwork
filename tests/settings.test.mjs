import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createSettingsStore } from "../settings.mjs";

test("AI starts disabled, metadata persists, session secrets never enter disk or public responses", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "branchwork-settings-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createSettingsStore({ directory });
  assert.equal((await store.load()).ai.enabled, false);
  await store.update("ai", {
    enabled: true,
    model: "test-model",
    apiKey: "test-secret-value",
  });
  await store.update("ai", { apiKey: "" });
  assert.equal((await store.load()).ai.apiKey, "test-secret-value");
  const publicState = await store.public();
  assert.equal(publicState.ai.hasApiKey, true);
  assert.equal(
    JSON.stringify(publicState).includes("test-secret-value"),
    false,
  );
  const saved = await fs.readFile(
    path.join(directory, "settings.json"),
    "utf8",
  );
  assert.equal(saved.includes("test-secret-value"), false);
  // Windows has no POSIX permission bits; the directory ACL protects the file there.
  if (process.platform !== "win32") {
    const stat = await fs.stat(path.join(directory, "settings.json"));
    assert.equal(stat.mode & 0o777, 0o600);
  }
  const next = createSettingsStore({ directory });
  assert.equal((await next.load()).ai.model, "test-model");
  assert.equal((await next.load()).ai.apiKey, "");
  await store.update("ai", { clearKey: true });
  assert.equal((await store.public()).ai.hasApiKey, false);
  await Promise.all([
    store.update("provider", { owner: "team" }),
    store.update("provider", { repository: "repo" }),
  ]);
  assert.equal((await store.load()).provider.owner, "team");
  assert.equal((await store.load()).provider.repository, "repo");
});
test("encrypted secret adapter round trips without storing plaintext", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "branchwork-secret-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32);
  const adapters = {
    directory,
    encrypt(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
    },
    decrypt(value) {
      const b = Buffer.from(value, "base64"),
        decipher = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      decipher.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([
        decipher.update(b.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
  const store = createSettingsStore(adapters);
  await store.update("provider", { token: "protected-token" });
  const saved = await fs.readFile(
    path.join(directory, "settings.json"),
    "utf8",
  );
  assert.equal(saved.includes("protected-token"), false);
  assert.equal(
    (await createSettingsStore(adapters).load()).provider.token,
    "protected-token",
  );
  assert.equal((await store.public()).secretStorage, "encrypted");
});
