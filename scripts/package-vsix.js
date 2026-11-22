"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { generateIconPng } = require("./generate-icon");

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

/**
 * 零外部依赖构建标准 ZIP 归档（强制 POSIX 正斜杠路径）。
 * @param {Array<{ name: string, data: Buffer }>} entries
 * @returns {Buffer}
 */
function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = toDosTimeDate();

  for (const entry of entries) {
    const posixName = entry.name.replace(/\\/g, "/");
    const nameBuf = Buffer.from(posixName, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralSize = centralParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".mjs" ContentType="application/javascript"/>
  <Default Extension=".svg" ContentType="image/svg+xml"/>
  <Default Extension=".png" ContentType="image/png"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>
`;
}

function buildVsixManifest(pkg) {
  const publisher = escapeXml(pkg.publisher || "local");
  const name = escapeXml(pkg.name);
  const version = escapeXml(pkg.version || "2.0.0");
  const displayName = escapeXml("agy-dart 融合控制台 (含 Capsule 遥测)");
  const description = escapeXml("面向 Antigravity IDE 的 agy-dart 与 agy-capsule 融合侧边栏与全宽面板扩展");
  const engine = escapeXml(pkg.engines?.vscode || "^1.100.0");

  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${name}" Version="${version}" Publisher="${publisher}"/>
    <DisplayName>${displayName}</DisplayName>
    <Description xml:space="preserve">${description}</Description>
    <Tags>Antigravity,agy-dart,agy-capsule,Dashboard,KV-Cache,Quota</Tags>
    <Categories>Other,Visualization</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${engine}"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui,workspace"/>
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value=""/>
    </Properties>
    <Icon>extension/assets/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/assets/icon.png" Addressable="true"/>
  </Assets>
</PackageManifest>
`;
}

const RUNTIME_FILES = [
  "package.json",
  "package.nls.json",
  "package.nls.zh-cn.json",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "assets/icon.svg",
  "assets/icon.png",
  "src/backendClient.js",
  "src/capsuleClient.js",
  "src/capsuleUi.js",
  "src/capsuleWorker.mjs",
  "src/conversations.js",
  "src/dashboardController.js",
  "src/extension.js",
  "src/htmlBuilder.js",
  "src/paths.js",
  "src/quotaMatcher.js",
  "src/statusBar.js"
];

function packageVsix(rootDir = path.resolve(__dirname, "..")) {
  const pkgPath = path.join(rootDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const iconPngPath = path.join(rootDir, "assets", "icon.png");
  if (!fs.existsSync(iconPngPath)) {
    generateIconPng(iconPngPath);
  }

  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from(buildContentTypesXml(), "utf8") },
    { name: "extension.vsixmanifest", data: Buffer.from(buildVsixManifest(pkg), "utf8") }
  ];

  for (const rel of RUNTIME_FILES) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`打包缺少必要文件: ${rel}`);
    }
    entries.push({
      name: `extension/${rel.replace(/\\/g, "/")}`,
      data: fs.readFileSync(abs)
    });
  }

  const outFile = path.join(rootDir, `${pkg.name}-${pkg.version}.vsix`);
  const zipBuf = buildZipBuffer(entries);
  fs.writeFileSync(outFile, zipBuf);
  return {
    vsixPath: outFile,
    entryCount: entries.length,
    bytes: zipBuf.length
  };
}

if (require.main === module) {
  const res = packageVsix();
  console.log(`Packaged VSIX: ${res.vsixPath} (${res.entryCount} entries, ${res.bytes} bytes)`);
}

module.exports = {
  RUNTIME_FILES,
  buildZipBuffer,
  packageVsix
};
