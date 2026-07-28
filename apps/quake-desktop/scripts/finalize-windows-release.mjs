import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(projectRoot, "release");
const guideSource = join(projectRoot, "docs", "windows-install.md");
const guideTarget = join(releaseDir, "KURULUM.md");
const oneClickSource = join(projectRoot, "scripts", "install-quake-code-windows.bat");
const oneClickName = "KUR-QUAKE-CODE.bat";
const oneClickTarget = join(releaseDir, oneClickName);
const transferDir = join(releaseDir, "transfer");

const installerNames = readdirSync(releaseDir)
  .filter((name) => /^Quake-Code-Setup-.*-x64\.exe$/i.test(name))
  .sort((left, right) => statSync(join(releaseDir, right)).mtimeMs - statSync(join(releaseDir, left)).mtimeMs)
  .slice(0, 1);

if (installerNames.length === 0) {
  throw new Error(`Windows installer bulunamadı: ${releaseDir}`);
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

const checksumLines = [];
for (const installerName of installerNames) {
  const checksum = await sha256(join(releaseDir, installerName));
  checksumLines.push(`${checksum}  ${installerName}`);
  console.log(`[release] ${installerName}`);
  console.log(`[release] SHA256 ${checksum}`);
}

const checksumContent = `${checksumLines.join("\n")}\n`;
writeFileSync(join(releaseDir, "SHA256SUMS.txt"), checksumContent, "utf8");
if (existsSync(guideSource)) copyFileSync(guideSource, guideTarget);
if (existsSync(oneClickSource)) copyFileSync(oneClickSource, oneClickTarget);

rmSync(transferDir, { recursive: true, force: true });
mkdirSync(transferDir, { recursive: true });
for (const installerName of installerNames) {
  copyFileSync(join(releaseDir, installerName), join(transferDir, installerName));
}
writeFileSync(join(transferDir, "SHA256SUMS.txt"), checksumContent, "utf8");
if (existsSync(guideSource)) copyFileSync(guideSource, join(transferDir, "KURULUM.md"));
if (existsSync(oneClickSource)) copyFileSync(oneClickSource, join(transferDir, oneClickName));

console.log(`[release] Kurulum rehberi: ${guideTarget}`);
console.log(`[release] Tek tık kurulum: ${oneClickTarget}`);
console.log(`[release] Aktarılacak dosyalar: ${transferDir}`);
