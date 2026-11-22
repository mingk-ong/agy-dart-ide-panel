"use strict";

const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const ALLOWED_API_PATH_RE = /^\/api\/[a-z0-9-]+$/i;
const STARTUP_TIMEOUT_MS = 8000;
const API_TIMEOUT_MS = 15000;

/**
 * 托管 agy-dart Sidecar 独立 HTTP 服务进程并通过本地回环代理全部 /api/* 请求。
 */
class AgyDartBackendClient {
  /**
   * @param {{
   *   resolveRuntime: () => { ok: boolean, pluginRoot?: string, nodePath?: string, error?: string },
   *   logger?: { log: (msg: string) => void }
   * }} options
   */
  constructor(options) {
    this._resolveRuntime = options.resolveRuntime;
    this._logger = options.logger || { log() {} };
    this._child = null;
    this._port = 0;
    this._csrfToken = "";
    this._pluginRoot = "";
    this._startPromise = null;
    this._disposed = false;
    this._lastFailureAt = 0;
  }

  /**
   * 校验并规范化接口路径，阻止非 /api/* 路径或路径穿越。
   * @param {string} apiPath
   * @returns {string}
   */
  static validateApiPath(apiPath) {
    const clean = String(apiPath || "").trim();
    if (!ALLOWED_API_PATH_RE.test(clean)) {
      throw new Error(`非法 API 路径: ${clean}`);
    }
    return clean;
  }

  /**
   * 获取当前受管后端是否在线。
   * @returns {boolean}
   */
  isRunning() {
    return Boolean(this._child && this._child.exitCode === null && !this._child.killed && this._port > 0 && this._csrfToken);
  }

  /**
   * 确保托管后端已启动并完成 CSRF 令牌握手。
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<{ port: number, csrfToken: string, pluginRoot: string }>}
   */
  async ensureStarted(options = {}) {
    if (this._disposed) {
      throw new Error("后端客户端已销毁");
    }
    if (!options.force && this.isRunning()) {
      return {
        port: this._port,
        csrfToken: this._csrfToken,
        pluginRoot: this._pluginRoot
      };
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
    const runtime = this._resolveRuntime();
    if (!runtime || !runtime.ok || !runtime.pluginRoot || !runtime.nodePath) {
      throw new Error(runtime?.error || "未能检测到已安装的 agy-dart 或可用 Node.js (>=22)");
    }

    // 清理旧残余进程，防止端口或进程句柄泄漏
    this._terminateChild();

    const serverScript = path.join(runtime.pluginRoot, "sidecars", "dashboard", "server.mjs");
    const env = { ...process.env };
    // 强制进入独立 HTTP 模式且使用随机空闲端口，移除 SidecarApp 环境变量避免误判
    delete env.ANTIGRAVITY_SIDECAR_WEB_PORT;
    delete env.ANTIGRAVITY_SIDECAR_UI_TOKEN;
    delete env.ANTIGRAVITY_LS_ADDRESS;
    delete env.ANTIGRAVITY_CSRF_TOKEN;
    delete env.ELECTRON_RUN_AS_NODE;
    env.SIDECAR_FORCE_HTTP = "1";
    env.PORT = "0";

    this._logger.log(`[后端] 启动托管服务: ${runtime.nodePath} ${serverScript}`);

    const child = spawn(runtime.nodePath, [serverScript], {
      cwd: runtime.pluginRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    this._child = child;
    this._pluginRoot = runtime.pluginRoot;

    const boundPort = await new Promise((resolve, reject) => {
      let stdoutBuf = "";
      let stderrBuf = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`托管服务启动超时 (${STARTUP_TIMEOUT_MS}ms)${stderrBuf ? `: ${stderrBuf.trim()}` : ""}`));
        }
      }, STARTUP_TIMEOUT_MS);
      if (typeof timer.unref === "function") {
        timer.unref();
      }

      const finish = (err, port) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (err) {
          reject(err);
        } else {
          resolve(port);
        }
      };

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stdoutBuf += text;
        const m = stdoutBuf.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (m) {
          const parsedPort = Number.parseInt(m[1], 10);
          if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
            finish(null, parsedPort);
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderrBuf += text;
        if (text.trim()) {
          this._logger.log(`[后端 stderr] ${text.trim()}`);
        }
      });

      child.once("error", (err) => {
        finish(new Error(`启动后端进程失败: ${err.message}`));
      });

      child.once("exit", (code, signal) => {
        if (this._child === child) {
          this._port = 0;
          this._csrfToken = "";
          this._child = null;
        }
        finish(new Error(`后端进程提前退出 (code=${code}, signal=${signal})${stderrBuf ? `: ${stderrBuf.trim()}` : ""}`));
      });
    }).catch((err) => {
      this._terminateChild();
      this._lastFailureAt = Date.now();
      throw err;
    });

    this._port = boundPort;
    // 启动后监听后续意外退出以便自动清零状态
    child.on("exit", (code, signal) => {
      if (this._child === child) {
        this._logger.log(`[后端] 托管进程已退出 (code=${code}, signal=${signal})`);
        this._port = 0;
        this._csrfToken = "";
        this._child = null;
      }
    });

    await this._fetchRootHtmlAndRefreshToken();
    this._logger.log(`[后端] 已就绪 http://127.0.0.1:${this._port}`);
    return {
      port: this._port,
      csrfToken: this._csrfToken,
      pluginRoot: this._pluginRoot
    };
  }

  /**
   * 获取后端根页面原始 HTML，并提取同步 CSRF Token。
   * @returns {Promise<string>}
   */
  async fetchDashboardHtml() {
    await this.ensureStarted();
    return this._fetchRootHtmlAndRefreshToken();
  }

  async _fetchRootHtmlAndRefreshToken() {
    if (!this._port) {
      throw new Error("后端端口尚未就绪");
    }
    const resp = await this._httpRequest({
      port: this._port,
      method: "GET",
      reqPath: "/",
      headers: {
        Host: `127.0.0.1:${this._port}`
      }
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`获取仪表盘 HTML 失败: HTTP ${resp.status}`);
    }
    const tokenMatch = resp.body.match(/<meta\s+name="agy-dart-token"\s+content="([^"]+)"/i);
    if (!tokenMatch || !tokenMatch[1]) {
      throw new Error("未能从服务端页面解析 X-Agy-Dart-Token");
    }
    this._csrfToken = tokenMatch[1];
    return resp.body;
  }

  /**
   * 代理调用 agy-dart 后端 /api/* 接口，支持自动令牌刷新与断线重连。
   * @param {string} apiPath
   * @param {string} [method]
   * @param {unknown} [body]
   * @returns {Promise<{ ok: boolean, status: number, data: any, text: string }>}
   */
  async requestApi(apiPath, method = "POST", body = {}) {
    const cleanPath = AgyDartBackendClient.validateApiPath(apiPath);
    const upperMethod = String(method || "POST").toUpperCase();
    if (upperMethod !== "POST" && upperMethod !== "GET") {
      throw new Error(`不支持的 HTTP 方法: ${upperMethod}`);
    }

    await this.ensureStarted();

    const executeOnce = async () => {
      const headers = {
        Host: `127.0.0.1:${this._port}`,
        "X-Agy-Dart-Token": this._csrfToken
      };
      let payloadStr;
      if (upperMethod === "POST") {
        headers["Content-Type"] = "application/json";
        if (typeof body === "string") {
          payloadStr = body || "{}";
        } else {
          payloadStr = JSON.stringify(body === undefined ? {} : body);
        }
        headers["Content-Length"] = String(Buffer.byteLength(payloadStr, "utf8"));
      }
      return this._httpRequest({
        port: this._port,
        method: upperMethod,
        reqPath: cleanPath,
        headers,
        body: payloadStr
      });
    };

    let resp;
    try {
      resp = await executeOnce();
      if (resp.status === 403) {
        // 令牌异常时刷新根页面重新取令牌并重试一次
        await this._fetchRootHtmlAndRefreshToken();
        resp = await executeOnce();
      }
    } catch (err) {
      // 后端进程意外退出或连接拒绝时重建一次后重试
      this._logger.log(`[后端] 请求 ${cleanPath} 异常 (${err.message})，尝试重启后端...`);
      await this.ensureStarted({ force: true });
      resp = await executeOnce();
    }

    let parsedData = null;
    try {
      parsedData = resp.body ? JSON.parse(resp.body) : {};
    } catch {
      parsedData = { raw: resp.body };
    }

    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      data: parsedData,
      text: resp.body
    };
  }

  _httpRequest({ port, method, reqPath, headers, body }) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: reqPath,
          method,
          headers,
          timeout: API_TIMEOUT_MS
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode || 0,
              body: Buffer.concat(chunks).toString("utf8")
            });
          });
        }
      );

      req.on("timeout", () => {
        req.destroy(new Error(`请求 ${reqPath} 超时 (${API_TIMEOUT_MS}ms)`));
      });
      req.on("error", (err) => {
        reject(err);
      });

      if (body !== undefined && body !== null) {
        req.write(body);
      }
      req.end();
    });
  }

  /**
   * 强制重启托管后端进程。
   * @returns {Promise<{ port: number, csrfToken: string, pluginRoot: string }>}
   */
  async restart() {
    this._logger.log("[后端] 收到重启请求，正在重建服务...");
    this._terminateChild();
    return this.ensureStarted({ force: true });
  }

  _terminateChild() {
    const child = this._child;
    this._child = null;
    this._port = 0;
    this._csrfToken = "";
    if (!child) {
      return;
    }
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

  /**
   * 销毁客户端并确保回收所有后台子进程。
   */
  dispose() {
    this._disposed = true;
    this._terminateChild();
  }
}

module.exports = {
  AgyDartBackendClient
};
