"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { getHomeDir } = require("./paths");

const CREDENTIAL_TARGET = "gemini:antigravity";
const CREDENTIAL_USERNAME = "antigravity";
const DEFAULT_OAUTH_SCOPES =
  "https://www.googleapis.com/auth/userinfo.email openid https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.profile";

const WINDOWS_CRED_READ_SCRIPT = `
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class AgyCredWin32 {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, uint type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("Advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr cred);

    public static int ReadTarget(string target, out string payload) {
        payload = "";
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) {
            return Marshal.GetLastWin32Error();
        }
        try {
            var cred = Marshal.PtrToStructure<CREDENTIAL>(ptr);
            byte[] bytes = new byte[cred.CredentialBlobSize];
            if (cred.CredentialBlobSize > 0 && cred.CredentialBlob != IntPtr.Zero) {
                Marshal.Copy(cred.CredentialBlob, bytes, 0, (int)cred.CredentialBlobSize);
            }
            string raw = Encoding.UTF8.GetString(bytes);
            if (raw.StartsWith("go-keyring-base64:")) {
                byte[] dec = Convert.FromBase64String(raw.Substring("go-keyring-base64:".Length));
                raw = Encoding.UTF8.GetString(dec);
            } else if (!raw.TrimStart().StartsWith("{")) {
                string utf16 = Encoding.Unicode.GetString(bytes);
                if (utf16.TrimStart().StartsWith("{")) {
                    raw = utf16;
                }
            }
            payload = raw;
            return 0;
        } finally {
            CredFree(ptr);
        }
    }
}
'@
$target = [Console]::In.ReadToEnd().Trim()
$outPayload = ""
$errCode = [AgyCredWin32]::ReadTarget($target, [ref]$outPayload)
if ($errCode -eq 1168) {
    exit 2
}
if ($errCode -ne 0) {
    [Console]::Error.WriteLine("CredReadW failed with Win32 error $errCode")
    exit 1
}
[Console]::Out.Write($outPayload)
`;

const WINDOWS_CRED_WRITE_SCRIPT = `
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class AgyCredWin32Write {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite(ref CREDENTIAL userCredential, uint flags);

    public static int WriteTarget(string target, string userName, string jsonPayload) {
        byte[] bytes = Encoding.UTF8.GetBytes(jsonPayload ?? "");
        IntPtr blob = Marshal.AllocCoTaskMem(Math.Max(1, bytes.Length));
        try {
            if (bytes.Length > 0) {
                Marshal.Copy(bytes, 0, blob, bytes.Length);
            }
            var cred = new CREDENTIAL {
                Flags = 0,
                Type = 1,
                TargetName = target,
                Comment = null,
                CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = blob,
                Persist = 2,
                AttributeCount = 0,
                Attributes = IntPtr.Zero,
                TargetAlias = null,
                UserName = userName
            };
            if (!CredWrite(ref cred, 0)) {
                return Marshal.GetLastWin32Error();
            }
            return 0;
        } finally {
            Marshal.FreeCoTaskMem(blob);
        }
    }
}
'@
$raw = [Console]::In.ReadToEnd()
$nl = $raw.IndexOf([char]10)
if ($nl -le 0) {
    [Console]::Error.WriteLine("Invalid credential input payload")
    exit 1
}
$header = $raw.Substring(0, $nl).Trim()
$json = $raw.Substring($nl + 1)
$parts = $header.Split([char]9, 2)
if ($parts.Length -lt 2) {
    [Console]::Error.WriteLine("Missing target/username header")
    exit 1
}
$errCode = [AgyCredWin32Write]::WriteTarget($parts[0], $parts[1], $json)
if ($errCode -ne 0) {
    [Console]::Error.WriteLine("CredWriteW failed with Win32 error $errCode")
    exit 1
}
`;

/**
 * 生成与 agy.exe 兼容的随机 writer_id。
 * @returns {string}
 */
function generateWriterId() {
  return crypto.randomBytes(12).toString("base64url");
}

/**
 * 对邮箱进行安全脱敏展示（保留首部与域名）。
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
  const clean = String(email || "").trim();
  if (!clean) return "";
  const atIdx = clean.indexOf("@");
  if (atIdx <= 0) {
    return clean.length <= 2 ? `${clean[0] || "*"}***` : `${clean.slice(0, 2)}***`;
  }
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx);
  if (local.length <= 1) return `*${domain}`;
  if (local.length === 2) return `${local[0]}*${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}

/**
 * 归一化各种过期时间格式（RFC3339 字符串、秒级或毫秒级时间戳）。
 * @param {string|number|null|undefined} expiryInput
 * @returns {{ expiryIso: string, expiryMs: number }}
 */
function normalizeExpiryIso(expiryInput) {
  if (expiryInput === null || expiryInput === undefined || expiryInput === "") {
    return { expiryIso: "", expiryMs: 0 };
  }
  let ms = NaN;
  if (typeof expiryInput === "number") {
    if (Number.isFinite(expiryInput) && expiryInput > 0) {
      ms = expiryInput < 1e12 ? Math.round(expiryInput * 1000) : Math.round(expiryInput);
    }
  } else {
    const str = String(expiryInput).trim();
    if (/^\d+(?:\.\d+)?$/.test(str)) {
      const num = Number(str);
      if (Number.isFinite(num) && num > 0) {
        ms = num < 1e12 ? Math.round(num * 1000) : Math.round(num);
      }
    } else {
      const parsed = Date.parse(str);
      if (Number.isFinite(parsed) && parsed > 0) {
        ms = parsed;
      }
    }
  }
  if (!Number.isFinite(ms) || ms <= 0) {
    return { expiryIso: "", expiryMs: 0 };
  }
  return {
    expiryIso: new Date(ms).toISOString(),
    expiryMs: ms
  };
}

/**
 * 组装符合 Antigravity IDE 2.8.0 (agy.exe) 主凭据规范的 JSON 结构。
 * @param {{ email?: string, authMethod?: string }} account
 * @param {{
 *   accessToken?: string,
 *   access_token?: string,
 *   refreshToken?: string,
 *   refresh_token?: string,
 *   tokenType?: string,
 *   token_type?: string,
 *   expiryMs?: number,
 *   expiryIso?: string,
 *   expiry?: string|number,
 *   expiry_date?: number,
 *   expiry_timestamp?: number,
 *   expiresIn?: number,
 *   expires_in?: number,
 *   email?: string,
 *   writerId?: string
 * }} secret
 * @returns {object}
 */
function buildSystemCredentialPayload(account = {}, secret = {}) {
  const email = String(account?.email || secret?.email || "").trim();
  const accessToken = String(secret?.accessToken ?? secret?.access_token ?? "").trim();
  const refreshToken = String(secret?.refreshToken ?? secret?.refresh_token ?? "").trim();
  const tokenType = String(secret?.tokenType ?? secret?.token_type ?? "Bearer").trim() || "Bearer";
  const expiryCandidate =
    secret?.expiryIso ??
    secret?.expiry ??
    secret?.expiryMs ??
    secret?.expiry_date ??
    secret?.expiry_timestamp ??
    0;
  const { expiryIso } = normalizeExpiryIso(expiryCandidate);
  const expiresInRaw = Number(secret?.expiresIn ?? secret?.expires_in ?? 3599);
  const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? Math.round(expiresInRaw) : 3599;

  const token = {
    access_token: accessToken,
    token_type: tokenType,
    refresh_token: refreshToken,
    expires_in: expiresIn
  };
  if (expiryIso) {
    token.expiry = expiryIso;
  }

  return {
    token,
    auth_method: String(account?.authMethod || "consumer").trim() || "consumer",
    id_token_email: email,
    writer_id: String(secret?.writerId || "").trim() || generateWriterId()
  };
}

/**
 * 解析操作系统凭据管理器中保存的 gemini:antigravity JSON。
 * @param {string|object} rawInput
 * @returns {{
 *   email: string,
 *   authMethod: string,
 *   writerId: string,
 *   accessToken: string,
 *   refreshToken: string,
 *   tokenType: string,
 *   idToken: string,
 *   expiryIso: string,
 *   expiryMs: number,
 *   expiresIn: number,
 *   raw: object
 * }}
 */
function parseSystemCredentialPayload(rawInput) {
  let obj = rawInput;
  if (typeof rawInput === "string") {
    const clean = rawInput.replace(/^\uFEFF/, "").trim();
    if (!clean) {
      throw new Error("凭据内容为空");
    }
    obj = JSON.parse(clean);
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("凭据 JSON 结构无效");
  }
  const tok = obj.token && typeof obj.token === "object" ? obj.token : obj;
  const email = String(obj.id_token_email || obj.email || tok.email || "").trim();
  const authMethod = String(obj.auth_method || "consumer").trim() || "consumer";
  const writerId = String(obj.writer_id || "").trim();
  const accessToken = String(tok.access_token || obj.access_token || "").trim();
  const refreshToken = String(tok.refresh_token || obj.refresh_token || "").trim();
  const tokenType = String(tok.token_type || obj.token_type || "Bearer").trim() || "Bearer";
  const idToken = String(tok.id_token || obj.id_token || "").trim();
  const { expiryIso, expiryMs } = normalizeExpiryIso(
    tok.expiry ?? tok.expiry_date ?? tok.expiry_timestamp ?? obj.expiry ?? obj.expiry_date
  );
  const expiresInRaw = Number(tok.expires_in ?? obj.expires_in ?? 3599);
  const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? Math.round(expiresInRaw) : 3599;

  return {
    email,
    authMethod,
    writerId,
    accessToken,
    refreshToken,
    tokenType,
    idToken,
    expiryIso,
    expiryMs,
    expiresIn,
    raw: obj
  };
}

/**
 * 读取当前操作系统凭据管理器中的 gemini:antigravity 凭据。
 * @param {{ platform?: string, exec?: typeof spawnSync, target?: string, username?: string }} [options]
 */
function readSystemCredential(options = {}) {
  const platform = options.platform || process.platform;
  const exec = options.exec || spawnSync;
  const target = options.target || CREDENTIAL_TARGET;
  const username = options.username || CREDENTIAL_USERNAME;

  let res;
  if (platform === "win32") {
    res = exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_CRED_READ_SCRIPT],
      {
        input: `${target}\n`,
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true
      }
    );
  } else if (platform === "darwin") {
    res = exec(
      "security",
      ["find-generic-password", "-s", "gemini", "-a", username, "-w"],
      {
        encoding: "utf8",
        timeout: 10000
      }
    );
  } else {
    res = exec(
      "secret-tool",
      ["lookup", "service", "gemini", "username", username],
      {
        encoding: "utf8",
        timeout: 10000
      }
    );
  }

  if (res?.error) {
    return {
      ok: false,
      notFound: false,
      error: `读取系统凭据失败: ${res.error.message}`
    };
  }

  const status = res?.status ?? -1;
  const stdout = String(res?.stdout || "").trim();
  const stderr = String(res?.stderr || "").trim();

  if (status === 2 || (platform !== "win32" && status !== 0 && !stdout && /not found|could not be found/i.test(stderr))) {
    return {
      ok: false,
      notFound: true,
      error: "系统凭据管理器中尚未保存 gemini:antigravity"
    };
  }
  if (status !== 0 || !stdout) {
    return {
      ok: false,
      notFound: status === 1 && !stdout && platform !== "win32",
      error: stderr || `读取系统凭据返回状态码 ${status}`
    };
  }

  try {
    const parsed = parseSystemCredentialPayload(stdout);
    return {
      ok: true,
      notFound: false,
      ...parsed
    };
  } catch (err) {
    return {
      ok: false,
      notFound: false,
      error: `解析系统凭据失败: ${err.message}`
    };
  }
}

/**
 * 将凭据 JSON 通过子进程 stdin 安全写入操作系统凭据管理器（绝不通过命令行参数传密）。
 * @param {object|string} payload
 * @param {{ platform?: string, exec?: typeof spawnSync, target?: string, username?: string }} [options]
 */
function writeSystemCredential(payload, options = {}) {
  const platform = options.platform || process.platform;
  const exec = options.exec || spawnSync;
  const target = options.target || CREDENTIAL_TARGET;
  const username = options.username || CREDENTIAL_USERNAME;

  const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (!jsonStr || !jsonStr.trim().startsWith("{")) {
    return { ok: false, error: "待写入的系统凭据载荷无效" };
  }

  let res;
  if (platform === "win32") {
    res = exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_CRED_WRITE_SCRIPT],
      {
        input: `${target}\t${username}\n${jsonStr}`,
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true
      }
    );
  } else if (platform === "darwin") {
    const escapedSecret = jsonStr.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const cmdLine = `add-generic-password -U -s "gemini" -a "${username}" -w "${escapedSecret}"\n`;
    res = exec("security", ["-i"], {
      input: cmdLine,
      encoding: "utf8",
      timeout: 10000
    });
  } else {
    res = exec(
      "secret-tool",
      ["store", `--label=${target}`, "service", "gemini", "username", username],
      {
        input: jsonStr,
        encoding: "utf8",
        timeout: 10000
      }
    );
  }

  if (res?.error) {
    return { ok: false, error: `写入系统凭据失败: ${res.error.message}` };
  }
  if ((res?.status ?? -1) !== 0) {
    return {
      ok: false,
      error: String(res?.stderr || res?.stdout || `写入系统凭据退出码 ${res?.status}`).trim()
    };
  }
  return { ok: true };
}

/**
 * 只读读取 ~/.gemini 兼容文件（oauth_creds.json 与 google_accounts.json）。
 * @param {{ geminiDir?: string }} [options]
 */
function readGeminiCompatFiles(options = {}) {
  const geminiDir = options.geminiDir || path.join(getHomeDir(), ".gemini");
  const oauthPath = path.join(geminiDir, "oauth_creds.json");
  const accountsPath = path.join(geminiDir, "google_accounts.json");

  let oauth = null;
  let accounts = null;

  try {
    if (fs.existsSync(oauthPath)) {
      oauth = JSON.parse(fs.readFileSync(oauthPath, "utf8").replace(/^\uFEFF/, ""));
    }
  } catch {
    oauth = null;
  }

  try {
    if (fs.existsSync(accountsPath)) {
      accounts = JSON.parse(fs.readFileSync(accountsPath, "utf8").replace(/^\uFEFF/, ""));
    }
  } catch {
    accounts = null;
  }

  return {
    geminiDir,
    oauthPath,
    accountsPath,
    oauth,
    accounts,
    activeEmail: String(accounts?.active || "").trim()
  };
}

function atomicWriteJson(filePath, dataObj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `${path.basename(filePath)}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`);
  const content = `${JSON.stringify(dataObj, null, 2)}\n`;
  try {
    fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

/**
 * 原子同步 ~/.gemini/oauth_creds.json 与 google_accounts.json（供 CLI 与旧工具兼容）。
 * @param {{
 *   email?: string,
 *   accessToken?: string,
 *   refreshToken?: string,
 *   tokenType?: string,
 *   expiryMs?: number,
 *   idToken?: string,
 *   scope?: string
 * }} creds
 * @param {{ geminiDir?: string, createDir?: boolean }} [options]
 */
function syncGeminiCompatFiles(creds = {}, options = {}) {
  const geminiDir = options.geminiDir || path.join(getHomeDir(), ".gemini");
  if (!fs.existsSync(geminiDir) && options.createDir === false) {
    return { ok: true, skipped: true };
  }

  const existing = readGeminiCompatFiles({ geminiDir });
  const email = String(creds.email || "").trim();
  const existingScope = typeof existing.oauth?.scope === "string" ? existing.oauth.scope.trim() : "";
  const nextScope = String(creds.scope || "").trim() || existingScope || DEFAULT_OAUTH_SCOPES;

  const oauthObj = {
    access_token: String(creds.accessToken || ""),
    refresh_token: String(creds.refreshToken || ""),
    token_type: String(creds.tokenType || "Bearer") || "Bearer",
    expiry_date: Number.isFinite(creds.expiryMs) && creds.expiryMs > 0 ? Math.round(creds.expiryMs) : Date.now() + 3600_000,
    ...(creds.idToken ? { id_token: String(creds.idToken) } : {}),
    scope: nextScope
  };
  atomicWriteJson(existing.oauthPath, oauthObj);

  if (email) {
    const prevActive = typeof existing.accounts?.active === "string" ? existing.accounts.active.trim() : "";
    const prevOld = Array.isArray(existing.accounts?.old) ? existing.accounts.old : [];
    const oldSet = new Set();
    const nextOld = [];
    const pushOld = (val) => {
      const clean = String(val || "").trim();
      if (!clean) return;
      const lower = clean.toLowerCase();
      if (lower === email.toLowerCase() || oldSet.has(lower)) return;
      oldSet.add(lower);
      nextOld.push(clean);
    };
    if (prevActive) pushOld(prevActive);
    for (const item of prevOld) pushOld(item);

    atomicWriteJson(existing.accountsPath, {
      active: email,
      old: nextOld
    });
  }

  return { ok: true, skipped: false, geminiDir };
}

function defaultIsPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/**
 * 扫描本机存活的 agy --hub 实例数量与详情（用于多窗口切号提醒防覆盖）。
 * @param {{ daemonDirs?: string[], isPidAlive?: (pid: number) => boolean }} [options]
 */
function detectActiveHubInstances(options = {}) {
  const dirs = Array.isArray(options.daemonDirs) && options.daemonDirs.length > 0
    ? options.daemonDirs
    : ["antigravity", "antigravity-ide", "antigravity-cli"].map((product) =>
        path.join(getHomeDir(), ".gemini", product, "daemon")
      );
  const checkAlive = options.isPidAlive || defaultIsPidAlive;

  const byPid = new Map();
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^hub_.*\.json$/i.test(name)) continue;
      const fullPath = path.join(dir, name);
      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, ""));
        const pid = Number(parsed?.pid);
        const port = Number(parsed?.httpPort);
        if (!Number.isInteger(pid) || pid <= 0 || !checkAlive(pid)) continue;
        if (!byPid.has(pid)) {
          byPid.set(pid, {
            pid,
            port: Number.isInteger(port) ? port : 0,
            filePath: fullPath
          });
        }
      } catch {}
    }
  }

  const hubs = Array.from(byPid.values());
  return {
    count: hubs.length,
    pids: hubs.map((h) => h.pid),
    hubs
  };
}

module.exports = {
  CREDENTIAL_TARGET,
  CREDENTIAL_USERNAME,
  DEFAULT_OAUTH_SCOPES,
  generateWriterId,
  maskEmail,
  normalizeExpiryIso,
  buildSystemCredentialPayload,
  parseSystemCredentialPayload,
  readSystemCredential,
  writeSystemCredential,
  readGeminiCompatFiles,
  syncGeminiCompatFiles,
  detectActiveHubInstances
};
