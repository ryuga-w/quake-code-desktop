import fs from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const gen = join(
  process.cwd(),
  "../../node_modules/@mrquake/quakecode-ai/dist/models.generated.js",
);
// desktop cwd is apps/quake-desktop when run from there
const candidates = [
  gen,
  join(process.cwd(), "node_modules/@mrquake/quakecode-ai/dist/models.generated.js"),
  join(process.cwd(), "../node_modules/@mrquake/quakecode-ai/dist/models.generated.js"),
  join(process.cwd(), "../../node_modules/@mrquake/quakecode-ai/dist/models.generated.js"),
];

const genPath = candidates.find((p) => fs.existsSync(p));
if (!genPath) {
  console.error("models.generated.js not found");
  process.exit(1);
}

let c = fs.readFileSync(genPath, "utf8");
const label = 'name: "Gemini 3.5 Flash (Antigravity)"';
if (!c.includes(label)) {
  const needle = `name: "Gemini 3 Flash (Antigravity)"`;
  const idx = c.indexOf(needle);
  if (idx < 0) {
    console.error("gemini-3-flash antigravity entry not found");
    process.exit(1);
  }
  const after = c.indexOf("        },", idx);
  const end = after + "        },".length;
  const insert = `
        "gemini-3.5-flash": {
            id: "gemini-3.5-flash",
            name: "Gemini 3.5 Flash (Antigravity)",
            api: "google-gemini-cli",
            provider: "google-antigravity",
            baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
            reasoning: true,
            input: ["text", "image"],
            cost: {
                input: 0.5,
                output: 3,
                cacheRead: 0.05,
                cacheWrite: 0,
            },
            contextWindow: 1048576,
            maxTokens: 65535,
        },`;
  c = c.slice(0, end) + insert + c.slice(end);
  fs.writeFileSync(genPath, c);
  console.log("patched", genPath);
} else {
  console.log("already in models.generated.js");
}

// Ensure models.json has it (merge into google-antigravity)
const modelsPath = join(homedir(), ".grok", "agent", "models.json");
if (fs.existsSync(modelsPath)) {
  const config = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
  config.providers = config.providers || {};
  const ga = config.providers["google-antigravity"] || {
    baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
    api: "google-gemini-cli",
    models: [],
  };
  ga.baseUrl = ga.baseUrl || "https://daily-cloudcode-pa.sandbox.googleapis.com";
  ga.api = ga.api || "google-gemini-cli";
  ga.models = Array.isArray(ga.models) ? ga.models : [];
  if (!ga.models.some((m) => m.id === "gemini-3.5-flash")) {
    ga.models.push({
      id: "gemini-3.5-flash",
      name: "Gemini 3.5 Flash (Antigravity)",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
      contextWindow: 1048576,
      maxTokens: 65535,
    });
    config.providers["google-antigravity"] = ga;
    fs.writeFileSync(modelsPath, JSON.stringify(config, null, 2) + "\n");
    console.log("updated models.json");
  } else {
    console.log("models.json already has gemini-3.5-flash");
  }
}

// Verify load
const require = createRequire(import.meta.url);
// Clear require cache for models
const modelsPathResolved = require.resolve("@mrquake/quakecode-ai/dist/models.js");
delete require.cache[modelsPathResolved];
const genResolved = require.resolve("@mrquake/quakecode-ai/dist/models.generated.js");
delete require.cache[genResolved];
const { getModels } = require("@mrquake/quakecode-ai/dist/models.js");
const ids = getModels("google-antigravity").map((m) => m.id);
console.log("antigravity models:", ids.join(", "));
console.log("has 3.5-flash:", ids.includes("gemini-3.5-flash"));
