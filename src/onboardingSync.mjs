import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 先抑制 Node 22+ 内置 SQLite 实验性警告，再动态导入 node:sqlite，保持 stderr 绝对干净
const origEmitWarning = process.emitWarning;
process.emitWarning = function filteredWarning(warning, ...args) {
  const msg = typeof warning === "string" ? warning : warning?.message || "";
  if (typeof msg === "string" && msg.includes("SQLite is an experimental feature")) {
    return;
  }
  return origEmitWarning.call(process, warning, ...args);
};
const { DatabaseSync } = await import("node:sqlite");

function getHomeDir() {
  if (process.platform === "win32") {
    return process.env.USERPROFILE || process.env.HOME || homedir();
  }
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function getStateVscdbPaths() {
  const home = getHomeDir();
  let userDataBase = "";
  if (process.platform === "win32") {
    userDataBase = process.env.APPDATA || join(home, "AppData", "Roaming");
  } else if (process.platform === "darwin") {
    userDataBase = join(home, "Library", "Application Support");
  } else {
    userDataBase = process.env.XDG_CONFIG_HOME || join(home, ".config");
  }
  return ["Antigravity IDE", "Antigravity"]
    .map((appName) => join(userDataBase, appName, "User", "globalStorage", "state.vscdb"))
    .filter((p) => existsSync(p));
}

/**
 * 原子同步 state.vscdb 全部 6 处引导完成状态键，防止切号后重复弹出「One last thing...」。
 * @param {string} email
 * @param {{ dbPaths?: string[], isGcpTos?: boolean }} [options]
 */
export function syncOnboardingEmail(email, options = {}) {
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail) {
    return { ok: false, error: "邮箱为空", updatedDbs: [], errors: [] };
  }

  const isGcpTosStr = options.isGcpTos ? "true" : "false";
  const targets = Array.isArray(options.dbPaths) ? options.dbPaths : getStateVscdbPaths();
  const updatedDbs = [];
  const errors = [];

  for (const dbPath of targets) {
    if (!dbPath || !existsSync(dbPath)) continue;
    let db = null;
    let inTxn = false;
    try {
      db = new DatabaseSync(dbPath);
      db.exec("PRAGMA busy_timeout = 5000;");
      db.exec("BEGIN IMMEDIATE;");
      inTxn = true;

      const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ItemTable'").get();
      if (!tbl) {
        db.exec("ROLLBACK;");
        inTxn = false;
        continue;
      }

      const upsertStmt = db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)");
      upsertStmt.run("agy.onboarding.lastLoginUsername", cleanEmail);
      upsertStmt.run("jetski.onboarding.lastLoginUsername", cleanEmail);
      upsertStmt.run("agy.onboarding.lastLoginIsGcpTos", isGcpTosStr);
      upsertStmt.run("jetski.onboarding.lastLoginIsGcpTos", isGcpTosStr);
      upsertStmt.run("antigravityOnboarding", "true");

      const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'google.google-antigravity'").get();
      if (row && typeof row.value === "string") {
        let obj = null;
        try {
          obj = JSON.parse(row.value);
        } catch {}
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          const storage =
            obj["antigravity-storage"] &&
            typeof obj["antigravity-storage"] === "object" &&
            !Array.isArray(obj["antigravity-storage"])
              ? obj["antigravity-storage"]
              : {};
          storage["agy.onboarding.lastLoginUsername"] = cleanEmail;
          storage["agy.onboarding.lastLoginIsGcpTos"] = isGcpTosStr;
          delete storage["jetski.onboarding.lastLoginUsername"];
          delete storage["jetski.onboarding.lastLoginIsGcpTos"];
          obj["antigravity-storage"] = storage;
          db.prepare("UPDATE ItemTable SET value = ? WHERE key = 'google.google-antigravity'").run(
            JSON.stringify(obj)
          );
        }
      }

      db.exec("COMMIT;");
      inTxn = false;
      updatedDbs.push(dbPath);
    } catch (err) {
      if (db && inTxn) {
        try {
          db.exec("ROLLBACK;");
        } catch {}
      }
      errors.push({ dbPath, error: err?.message || String(err) });
    } finally {
      if (db) {
        try {
          db.close();
        } catch {}
      }
    }
  }

  return {
    ok: updatedDbs.length > 0,
    updatedDbs,
    errors
  };
}
