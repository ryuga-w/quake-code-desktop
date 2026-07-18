const fs = require("fs");
const os = require("os");
const path = require("path");

function getWindowsBinDir() {
  const appData = process.env.APPDATA;
  if (appData) {
    return path.join(appData, "npm");
  }
  return path.join(os.homedir(), "AppData", "Roaming", "npm");
}

function getNpmBinDir() {
  if (process.platform === "win32") {
    return getWindowsBinDir();
  }

  const prefix = process.env.npm_config_prefix || process.env.NPM_CONFIG_PREFIX;
  if (prefix) {
    return path.join(prefix, "bin");
  }

  return null;
}

function getCliEntry() {
  const localPackage = path.join(process.cwd(), "node_modules", "@mrquake", "quakecode-cli", "dist", "cli.js");
  if (fs.existsSync(localPackage)) {
    return localPackage;
  }

  const workspacePackage = path.join(process.cwd(), "packages", "coding-agent", "dist", "cli.js");
  if (fs.existsSync(workspacePackage)) {
    return workspacePackage;
  }

  return null;
}

function toPosixPath(winPath) {
  return winPath
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):\//, (_match, drive) => `/mnt/${drive.toLowerCase()}/`);
}

function toSlashPath(winPath) {
  return winPath.replace(/\\/g, "/");
}

function makeCmdWrapper(targetPath) {
  return [
    "@ECHO off",
    "SETLOCAL",
    'SET "_prog=node"',
    'IF EXIST "%~dp0node.exe" SET "_prog=%~dp0node.exe"',
    `"%_prog%" "${targetPath}" %*`,
    "",
  ].join("\r\n");
}

function makeShWrapper(targetPath) {
  const posixTargetPath = toPosixPath(targetPath);
  const slashTargetPath = toSlashPath(targetPath);
  return [
    "#!/usr/bin/env sh",
    "set -e",
    `win_target='${targetPath.replace(/'/g, "'\\''")}'`,
    `wsl_target='${posixTargetPath.replace(/'/g, "'\\''")}'`,
    `slash_target='${slashTargetPath.replace(/'/g, "'\\''")}'`,
    'if command -v cygpath >/dev/null 2>&1; then',
    '  target="$(cygpath -u "$win_target")"',
    'elif [ -e "$wsl_target" ]; then',
    '  target="$wsl_target"',
    "else",
    '  target="$slash_target"',
    "fi",
    'exec node "$target" "$@"',
    "",
  ].join("\n");
}

function makePs1Wrapper(targetPath) {
  const escapedTargetPath = targetPath.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$target = '${escapedTargetPath}'`,
    "& node $target @args",
    "exit $LASTEXITCODE",
    "",
  ].join("\r\n");
}

function writeIfChanged(filePath, content) {
  try {
    if (fs.existsSync(filePath)) {
      const current = fs.readFileSync(filePath, "utf8");
      if (current === content) {
        return false;
      }
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch (error) {
    console.warn(`[install-qd-shim] Skipped ${filePath}: ${error.message}`);
    return false;
  }
}

function main() {
  const binDir = getNpmBinDir();
  const cliEntry = getCliEntry();

  if (!binDir || !cliEntry) {
    return;
  }

  const wrappers = ["qd", "quake-code", "quake", "qc"];
  let changed = false;

  for (const name of wrappers) {
    const cmdPath = path.join(binDir, `${name}.cmd`);
    changed = writeIfChanged(cmdPath, makeCmdWrapper(cliEntry)) || changed;

    if (process.platform === "win32") {
      const ps1Path = path.join(binDir, `${name}.ps1`);
      changed = writeIfChanged(ps1Path, makePs1Wrapper(cliEntry)) || changed;
    }

    if (process.platform === "win32") {
      const shPath = path.join(binDir, name);
      changed = writeIfChanged(shPath, makeShWrapper(cliEntry)) || changed;
    }
  }

  if (changed) {
    console.log(`[install-qd-shim] Installed command shim in ${binDir}`);
  }
}

main();
