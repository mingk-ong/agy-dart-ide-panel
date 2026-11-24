"use strict";

const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");

const REQUEST_TIMEOUT_MS = 20000;

/**
 * 托管 Antigravity 融合面板 stdio JSON-RPC Worker 进程，独立于 agy-dart 插件运行。
 */
class CapsuleClient {
  /**
   * @param {{
   *   resolveNodePath: () => { ok: boolean, nodePath?: string, error?: string },
   *   logger?: { log: (msg: string) => void }
   * }} options
   */
  constructor(options) {
    this._resolveNodePath = options.resolveNodePath;
    this._logger = options.logger || { log() {} };
    this._child = null;
    this._rl = null;
    this._startPromise = null;
    this._pending = new Map();
    this._seq = 0;
    this._disposed = false;
  }

  /**
   * 当前 Worker 是否存活。
   * @returns {boolean}
   */
  isRunning() {
    return Boolean(this._child && this._child.exitCode === null && !this._child.killed);
  }

  async _ensureStarted() {
    if (this._disposed) {
      throw new Error("Capsule 客户端已销毁");
    }
    if (this.isRunning()) {
      return;
    }
    if (this._startPromise) {
      return this._startPromise;
    }
    this._startPromise = this._startInternal().finally(() => {
      this._startPromise = null;
    });
    return this._startPromise;
  }

  async _startInternal() {
    const nodeRes = this._resolveNodePath();
    if (!nodeRes || !nodeRes.ok || !nodeRes.nodePath) {
      throw new Error(nodeRes?.error || "未找到可用的 Node.js (>=22)");
    }

    this._terminateChild();

    const workerPath = path.join(__dirname, "capsuleWorker.mjs");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(nodeRes.nodePath, [workerPath], {
      cwd: os.tmpdir(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this._child = child;

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this._rl = rl;
    rl.on("line", (line) => {
      if (!line || !line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const entry = this._pending.get(msg.id);
      if (!entry) return;
      this._pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) {
        entry.resolve(msg.data);
      } else {
        entry.reject(new Error(msg.error || "Capsule Worker 返回错误"));
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) {
        this._logger.log(`[Capsule stderr] ${text}`);
      }
    });

    const rejectAllPending = (reason) => {
      for (const [id, entry] of this._pending.entries()) {
        this._pending.delete(id);
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
      }
    };

    child.on("exit", (code, signal) => {
      if (this._child === child) {
        this._child = null;
        this._rl = null;
      }
      rejectAllPending(`Capsule Worker 已退出 (code=${code}, signal=${signal})`);
    });

    child.on("error", (err) => {
      rejectAllPending(`Capsule Worker 进程错误: ${err.message}`);
    });

    await this._callRaw("ping", {});
    this._logger.log(`[Capsule] 本地遥测 Worker 已就绪 (PID ${child.pid})`);
  }

  _callRaw(method, params = {}) {
    if (!this._child || !this._child.stdin || this._child.stdin.destroyed) {
      return Promise.reject(new Error("Capsule Worker 标准输入不可用"));
    }
    const id = `cap-${++this._seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Capsule RPC '${method}' 超时 (${REQUEST_TIMEOUT_MS}ms)`));
      }, REQUEST_TIMEOUT_MS);
      if (typeof timer.unref === "function") {
        timer.unref();
      }
      this._pending.set(id, { resolve, reject, timer });
      try {
        this._child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch (err) {
        this._pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * 发起 JSON-RPC 调用（支持断线自恢复一次）。
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  async call(method, params = {}) {
    await this._ensureStarted();
    try {
      return await this._callRaw(method, params);
    } catch (err) {
      if (this._disposed) throw err;
      this._logger.log(`[Capsule] 调用 ${method} 异常 (${err.message})，尝试重启 Worker...`);
      await this._ensureStarted();
      return this._callRaw(method, params);
    }
  }

  inspectConversation(conversationId = "") {
    return this.call("inspectConversation", { conversationId });
  }

  getQuota(force = false) {
    return this.call("getQuota", { force: Boolean(force) });
  }

  getUsageHistory(activeConversationId = "") {
    return this.call("getUsageHistory", { activeConversationId });
  }

  queryUsageAnalytics(params = {}) {
    return this.call("queryUsageAnalytics", params);
  }

  syncOnboardingEmail(email, options = {}) {
    return this.call("syncOnboardingEmail", {
      email: String(email || "").trim(),
      isGcpTos: Boolean(options.isGcpTos)
    });
  }

  async restart() {
    this._terminateChild();
    await this._ensureStarted();
  }

  _terminateChild() {
    const child = this._child;
    this._child = null;
    if (this._rl) {
      try {
        this._rl.close();
      } catch {}
      this._rl = null;
    }
    for (const [id, entry] of this._pending.entries()) {
      this._pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new Error("Capsule Worker 已重建"));
    }
    if (!child) return;
    const pid = child.pid;
    try {
      child.removeAllListeners("exit");
      child.kill();
    } catch {}
    if (process.platform === "win32" && pid) {
      try {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
          timeout: 3000,
          windowsHide: true
        });
      } catch {}
    }
  }

  dispose() {
    this._disposed = true;
    this._terminateChild();
  }
}

module.exports = {
  CapsuleClient
};
