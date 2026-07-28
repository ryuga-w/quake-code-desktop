import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const REPLACEMENTS = [
  ["…", "…"],
  ["—", "—"],
  ["“", "\u201c"],
  ["”", "\u201d"],
  ["→", "→"],
  ["✓", "✓"],
  ["—", "—"],
  ["›", "›"],
  ["•", "•"],
  ["‚", "‚"],
  ["‚", "‚"],
  ["ş", "ş"],
  ["Ş", "Ş"],
  ["ğ", "ğ"],
  ["Ğ", "Ğ"],
  ["ı", "ı"],
  ["İ", "İ"],
  ["ü", "ü"],
  ["Ü", "Ü"],
  ["ö", "ö"],
  ["Ö", "Ö"],
  ["ç", "ç"],
  ["Ç", "Ç"],
  ["·", "·"],
  ["×", "×"],
  ["'", "'"],
  ["'", "'"],
  ["'", "'"],
];

const EXT = new Set([".ts", ".tsx", ".css", ".md", ".mjs", ".json"]);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(name))) out.push(full);
  }
  return out;
}

function fixText(text) {
  let next = text;
  for (const [from, to] of REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  return next;
}

let changed = 0;
for (const file of walk(ROOT)) {
  const raw = fs.readFileSync(file, "utf8");
  const fixed = fixText(raw);
  if (fixed !== raw) {
    fs.writeFileSync(file, fixed, "utf8");
    changed += 1;
    console.log(path.relative(ROOT, file));
  }
}

console.log(`\nFixed ${changed} file(s).`);