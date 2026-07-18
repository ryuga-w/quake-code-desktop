const fs = require("fs");
const path = require("path");

const root = process.cwd();
const packageMap = {
  "@openclaw/core": "openclaw-core",
  "@openclaw/prism": "openclaw-prism",
  "@openclaw/driver-win32": "openclaw-driver-win32",
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", ".quake-code"].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const modules = new Map();
for (const pkg of Object.keys(packageMap)) modules.set(pkg, new Set());

function addModule(spec, names) {
  const base = Object.keys(packageMap).find((p) => spec === p || spec.startsWith(p + "/"));
  if (!base) return;
  if (!modules.has(spec)) modules.set(spec, new Set());
  for (const n of names) if (n && /^[A-Za-z_$][\w$]*$/.test(n)) modules.get(spec).add(n);
}

const files = walk(path.join(root, "packages"));
const fromRe = /(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s+from\s+["'](@openclaw\/(?:core|prism|driver-win32)(?:\/[^"']*)?)["']/g;
const dynRe = /import\(\s*["'](@openclaw\/(?:core|prism|driver-win32)(?:\/[^"']*)?)["']\s*\)/g;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  let m;
  while ((m = fromRe.exec(text))) {
    const clause = m[1] || "";
    const spec = m[2];
    const names = [];
    const brace = clause.match(/\{([\s\S]*?)\}/);
    if (brace) {
      for (const raw of brace[1].split(",")) {
        let n = raw.trim();
        if (!n) continue;
        n = n.replace(/^type\s+/, "").trim();
        n = n.split(/\s+as\s+/i)[0].trim();
        if (n) names.push(n);
      }
    }
    addModule(spec, names);
  }
  while ((m = dynRe.exec(text))) addModule(m[1], []);
}

function stubJs(names, label) {
  const unique = [...new Set(names)].filter((n) => n !== "default").sort();
  return `const makeStub = (name) => new Proxy(function openclawLocalStub() { return undefined; }, {\n` +
    `  get(_target, prop) { if (prop === "then") return undefined; if (prop === Symbol.toStringTag) return "OpenClawLocalStub"; return makeStub(name + "." + String(prop)); },\n` +
    `  apply() { return undefined; },\n` +
    `  construct() { return {}; }\n` +
    `});\n` +
    `const defaultExport = makeStub(${JSON.stringify(label)});\n` +
    `export default defaultExport;\n` +
    unique.map((n) => `export const ${n} = makeStub(${JSON.stringify(n)});`).join("\n") +
    (unique.length ? "\n" : "");
}

function stubDts(names) {
  const unique = [...new Set(names)].filter((n) => n !== "default").sort();
  return `declare const defaultExport: any;\nexport default defaultExport;\n` +
    unique.map((n) => `export declare const ${n}: any;\nexport type ${n} = any;`).join("\n") +
    (unique.length ? "\n" : "");
}

for (const [pkg, folder] of Object.entries(packageMap)) {
  const dir = path.join(root, "packages", folder);
  const dist = path.join(dir, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: pkg,
    version: "2026.4.2",
    private: true,
    type: "module",
    main: "./dist/index.js",
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./*": { types: "./dist/*.d.ts", import: "./dist/*.js" }
    }
  }, null, 2) + "\n");

  const rootNames = modules.get(pkg) || new Set();
  fs.writeFileSync(path.join(dist, "index.js"), stubJs(rootNames, pkg));
  fs.writeFileSync(path.join(dist, "index.d.ts"), stubDts(rootNames));
}

for (const [spec, names] of modules.entries()) {
  const base = Object.keys(packageMap).find((p) => spec === p || spec.startsWith(p + "/"));
  if (!base || spec === base) continue;
  const rel = spec.slice(base.length + 1);
  const dir = path.join(root, "packages", packageMap[base], "dist");
  const jsPath = path.join(dir, rel + ".js");
  const dtsPath = path.join(dir, rel + ".d.ts");
  fs.mkdirSync(path.dirname(jsPath), { recursive: true });
  fs.writeFileSync(jsPath, stubJs(names, spec));
  fs.writeFileSync(dtsPath, stubDts(names));
}

console.log("OpenClaw local stubs ready:");
for (const [spec, names] of modules.entries()) {
  if (spec.startsWith("@openclaw/")) console.log(`  ${spec}: ${[...names].sort().join(", ") || "no named imports"}`);
}
