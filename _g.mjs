import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti.import("./apps/quake-desktop/.quake-code/extensions/quake-chrome-bridge/index.ts");
const factory = mod.default ?? mod;
const handlers = {};
factory({
  registerTool:()=>{}, registerCommand:()=>{},
  on:(ev,fn)=>{ (handlers[ev]=handlers[ev]||[]).push(fn); },
  getSessionName:()=>"TestAgent",
});
// simulate before_agent_start
let res;
for (const fn of (handlers["before_agent_start"]||[])) {
  res = await fn({ systemPrompt: "BASE_PROMPT", prompt:"hi" }, { ui:{notify(){}} });
}
const sp = res && res.systemPrompt || "";
console.log("systemPrompt donduruldu:", !!res && typeof res.systemPrompt==="string");
console.log("BASE korundu:", sp.includes("BASE_PROMPT"));
console.log("guide eklendi:", sp.includes("Quake Chrome Bridge") && sp.includes("chrome_close_my_groups") && sp.includes("Auto working-group"));
// second call should NOT re-inject
let res2;
for (const fn of (handlers["before_agent_start"]||[])) res2 = await fn({ systemPrompt: "BASE2", prompt:"hi" }, {ui:{notify(){}}});
console.log("ikinci turda tekrar enjekte etmiyor:", res2===undefined);
