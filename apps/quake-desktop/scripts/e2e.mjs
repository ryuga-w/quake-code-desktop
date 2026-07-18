/**
 * Legacy source-contract + thin browser walk.
 * Canonical browser E2E is Playwright (`npm run test:e2e`, see test/e2e/smoke.spec.ts).
 * This script remains for monorepo smoke wiring; prefer Playwright for UI selectors.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = Number(process.env.QUAKE_WEB_E2E_PORT ?? 3991);
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  QUAKE_WEB_AUTH: "0",
  QUAKE_WEB_PORT: String(port),
  QUAKE_WEB_HOST: "127.0.0.1",
};

const server = spawn(process.execPath, ["apps/quake-desktop/dist/server/index.js"], {
  cwd: new URL("../../..", import.meta.url),
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
server.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

let browser;
try {
  await waitForReady();
  browser = await chromium.launch({ headless: true, ...browserLaunchFallback() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  const title = await page.title();
  if (title !== "Quake Code") throw new Error(`unexpected page title: ${title}`);
  assertNoRawEditorTabPrefixes();
  assertNoRawFileTreeSearchArrow();
  assertNoRawSecurityTokenCopy();
  assertNoDormantFileEditAction();
  assertNoDormantComposerAccessOptions();
  assertNoLegacyTopbarChrome();
  assertNoDormantLegacyShellCode();
  assertNoAsciiEllipsisInVisibleUi();
  assertNoRawTerminalTranscriptGlyphs();
  assertNoRawJsonInspectorCopy();
  assertPlanModeSwitchDoesNotResetActiveMode();
  assertAssistantPlanSummaryCannotSelfComplete();
  assertPlanCompletionNeedsWholePlanSignal();
  assertPendingPlanDecisionMarksPlanReady();
  assertPlanClarificationBlocksAreHiddenFromChat();
  assertInternalPlanTriggerMessagesAreHiddenFromChat();
  assertPlanExecutionRunsAsSingleAgentTurn();
  assertStreamingExecutionProgressFeedsPlanPanel();
  assertPromptConversationModeIsBidirectional();
  assertApplyPlanDecisionSwitchesComposerToExecute();
  assertComposerApplyDoesNotDisableActivePlanFlow();
  assertPendingPlanInteractionCanBeCancelledBeforeRuntimeLock();
  assertPlanUiResponsesBypassRuntimeLock();
  assertPlanClarificationDefaultFlagSurvivesSync();
  assertPlanCompletionStopsComposerStreamingBadge();
  assertExecutionCompletionHasTextFallback();
  assertTurkishPlanPromptAvoidsEnglishVerificationHeading();
  assertNewSessionClearsPendingPlanUi();
  assertPlanClarificationProtocolAndUi();
  assertTimelineToolHistoryIsWindowed();
  assertToolsPanelIsWindowed();
  assertChangeSummariesAreWindowed();
  assertApiErrorsAreLocalized();
  assertTimelineMessageModeSkipsToolSubscription();
  assertTimelineVisibleMessagesAreWindowed();
  assertTimelineToolsAvoidFullToolArray();
  assertMarkdownToolNoticeSelectionIsBounded();
  assertMarkdownToolBatchSummaryIsSinglePass();
  assertMarkdownToolLineStatsAvoidLargeSplits();
  assertMarkdownToolPreviewsAvoidLargeSplits();
  assertMarkdownToolOutputPreviewIsBounded();
  assertStreamingUsesMarkdownMessage();
  assertChangeSummariesAvoidFullToolArray();
  assertToolsPanelAvoidsFullToolSort();
  assertToolGroupingAvoidsArrayCopyChurn();
  assertPatchSummariesAvoidRepeatedSplits();
  assertAppStorePrunesToolsWithoutFullSort();
  assertAppStoreNormalizesMessagesInSinglePass();
  assertReadyEventCountsAssistantTurnsWithoutFilterAllocation();
  assertAppShellUsesVisibleMessageCount();
  assertCommandPaletteSearchIsBounded();
  assertFilesPanelTreeIsWindowedBeforeMaterializing();
  assertSessionsPanelSearchIsBounded();
  await page.locator("#app").waitFor({ timeout: 10_000 });
  // Empty chat has no #timeline; shell + composer are the stable smoke surface.
  await page.locator("#composer").waitFor({ timeout: 10_000 });
  await page.locator("#prompt").waitFor({ timeout: 10_000 });

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  const commandPalette = page.getByRole("dialog", { name: "Komut paleti" });
  await commandPalette.waitFor({ timeout: 10_000 });
  const commandPaletteInput = commandPalette.locator("input");
  const paletteText = await commandPalette.innerText();
  if (!paletteText.includes("Yapılandırma")) throw new Error("command palette refresh copy is not localized");
  if (/\b(Config|auth)\b/i.test(paletteText)) throw new Error(`command palette has raw technical copy: ${paletteText}`);
  await commandPaletteInput.fill("zzzz-no-result-command");
  await commandPalette.getByText("Eşleşme yok").waitFor({ timeout: 10_000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await commandPalette.waitFor({ state: "detached", timeout: 10_000 });

  await page.locator("button[title='Ayarlar']").click();
  await page.getByRole("dialog", { name: "Ayarlar" }).waitFor({ timeout: 10_000 });
  await page.getByRole("navigation", { name: "Ayar bölümleri" }).waitFor({ timeout: 10_000 });
  const settingsText = await page.getByRole("dialog", { name: "Ayarlar" }).innerText();
  if (settingsText.includes("Quake Web") || settingsText.includes("Quake Code tercihleri")) throw new Error("settings page still references old branding copy");
  await page.getByRole("button", { name: "Uygulamaya geri dön" }).click();

  await page.evaluate(async () => {
    const res = await fetch("/api/file?path=package.json");
    if (!res.ok) throw new Error(`file preview failed: ${res.status}`);
    const file = await res.json();
    if (!file.content.includes("quake-code-monorepo") && !file.content.includes("quake-desktop") && !file.content.includes("@mrquake/quake-desktop")) {
      throw new Error("file preview content mismatch");
    }
  });
  await page.evaluate(async () => {
    const rootsRes = await fetch("/api/workspace/roots");
    if (!rootsRes.ok) throw new Error(`workspace roots failed: ${rootsRes.status}`);
    const roots = await rootsRes.json();
    const labels = (roots.roots || []).map((root) => root.label);
    if (!labels.includes("Geçerli çalışma alanı")) throw new Error(`current workspace label is not localized: ${labels.join(", ")}`);

    const escapeRes = await fetch("/api/file?path=../package.json");
    const escapeBody = await escapeRes.json().catch(() => ({}));
    if (escapeBody.error !== "Çalışma alanı dışına çıkılamaz") throw new Error(`path escape error is not localized: ${escapeBody.error}`);
  });

  await page.evaluate(async () => {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error(`state failed: ${res.status}`);
    const state = await res.json();
    if (!state.state?.cwd) throw new Error("missing cwd");
  });

  // Terminal: API policy check (UI is xterm bottom panel / terminal-surface, not legacy input testids).
  await page.evaluate(async () => {
    const blocked = await fetch("/api/terminal/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "git reset --hard HEAD" }),
    });
    const body = await blocked.json().catch(() => ({}));
    if (body.error !== "git reset --hard engellendi") {
      throw new Error(`blocked terminal message is not localized: ${body.error || body.message}`);
    }
  });

  await page.keyboard.press(process.platform === "darwin" ? "Meta+J" : "Control+J");
  await page.locator("[data-testid='terminal-surface']").waitFor({ timeout: 15_000 });

  if (await page.locator(".advanced-command").count()) throw new Error("legacy advanced command runner is still mounted");

  await assertNoVisualLeaks(page, "desktop shell");
  await assertComposerErgonomics(page, "desktop composer");

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  mobilePage.on("pageerror", (error) => errors.push(error.message));
  mobilePage.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
  });
  await mobilePage.goto(base, { waitUntil: "domcontentloaded" });
  await mobilePage.locator("#app").waitFor({ timeout: 10_000 });
  await mobilePage.locator("#composer").waitFor({ timeout: 10_000 });
  await mobilePage.locator("#prompt").waitFor({ timeout: 10_000 });
  await assertNoVisualLeaks(mobilePage, "mobile shell");
  await assertComposerErgonomics(mobilePage, "mobile composer");
  await mobilePage.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await mobilePage.getByRole("dialog", { name: "Komut paleti" }).waitFor({ timeout: 10_000 });
  await assertNoVisualLeaks(mobilePage, "mobile command palette");
  await mobilePage.keyboard.press("Escape");
  await mobilePage.close();

  if (errors.length) throw new Error(`Browser console errors:\n${errors.join("\n")}`);
  console.log("quake_web_e2e_ok");
} finally {
  await browser?.close().catch(() => {});
  server.kill("SIGTERM");
}

function browserLaunchFallback() {
  const candidates = [
    process.env.QUAKE_WEB_E2E_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => existsSync(candidate));
  return executablePath ? { executablePath } : {};
}

function assertNoRawEditorTabPrefixes() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (/tab\.dirty\s*\?\s*["'`]ÔùÅ\s/.test(source) || /tab\.mode\s*===\s*["'`]diff["'`]\s*\?\s*["'`]╬ö\s/.test(source)) {
    throw new Error("editor tabs still render raw dirty/diff symbol prefixes");
  }
}

function assertNoRawFileTreeSearchArrow() {
  const source = readFileSync(new URL("../src/client/src/components/files/FilesPanel.tsx", import.meta.url), "utf8");
  if (source.includes(">Ôå│<") || source.includes('"Ôå│"')) {
    throw new Error("file search results still render a raw branch arrow");
  }
}

function assertNoRawSecurityTokenCopy() {
  const sources = [
    readFileSync(new URL("../src/client/src/components/security/SecurityBanner.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/settings/SettingsPanels.tsx", import.meta.url), "utf8"),
  ].join("\n");
  if (/Client token|yerel token/i.test(sources)) {
    throw new Error("security UI still exposes raw token wording");
  }
}

function assertNoDormantFileEditAction() {
  const sources = [
    readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/files/FilesPanel.tsx", import.meta.url), "utf8"),
  ].join("\n");
  if (/onFutureEdit|henüz açık değil|Güvenli düzenleme akışı/.test(sources)) {
    throw new Error("file tree still exposes a dormant edit action");
  }
}

function assertNoDormantComposerAccessOptions() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (/Güvenli düzenleme|Salt okunur/.test(source)) {
    throw new Error("composer access control still exposes unwired modes");
  }
}

function assertNoLegacyTopbarChrome() {
  const sources = [
    readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/styles.css", import.meta.url), "utf8"),
  ].join("\n");
  if (/TimelineToolbar|timeline-toolbar|\btopbar\b|topbar-/.test(sources)) {
    throw new Error("legacy topbar/timeline toolbar chrome is still present in the web shell");
  }
}

function assertNoDormantLegacyShellCode() {
  const sources = [
    readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/terminal/TerminalPanel.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/terminal/TerminalPanel.module.css", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/styles.css", import.meta.url), "utf8"),
  ].join("\n");
  if (/settings-page|settings-nav|settings-logo|settings-stack|settings-facts|settings-danger|ToolActivityStrip|activity-strip|TerminalDrawer|terminal-drawer|drawerHead|event-card/.test(sources)) {
    throw new Error("dormant legacy shell/settings/activity code is still present");
  }
}

function assertNoAsciiEllipsisInVisibleUi() {
  const sources = [
    readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/terminal/TerminalPanel.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/files/FilesPanel.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/markdown/MarkdownMessage.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/command/CommandPalette.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/sessions/SessionsPanel.tsx", import.meta.url), "utf8"),
  ].join("\n");
  const rawVisibleEllipsis = [
    "Çalışıyor...",
    "çalışıyor...",
    "Hazırlanıyor...",
    "hazırlanıyor...",
    "Yanıt hazırlanıyor...",
    "Gönderiliyor...",
    "yükleniyor...",
    "aranıyor...",
    "ara...",
    "filtrele...",
  ].filter((text) => sources.includes(text));
  if (rawVisibleEllipsis.length) {
    throw new Error(`visible UI still uses raw ascii ellipsis: ${rawVisibleEllipsis.join(", ")}`);
  }
}

function assertNoRawTerminalTranscriptGlyphs() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (source.includes("ÔûÂ") || source.includes("Ôûá Durdurma")) {
    throw new Error("terminal transcript still uses raw play/stop glyphs instead of shell-style status text");
  }
}

function assertNoRawJsonInspectorCopy() {
  const sources = [
    readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/markdown/MarkdownMessage.tsx", import.meta.url), "utf8"),
  ].join("\n");
  if (/items omitted|keys omitted|\[Circular\]/.test(sources)) {
    throw new Error("tool JSON inspectors still expose raw English/debug truncation copy");
  }
}

function assertPlanModeSwitchDoesNotResetActiveMode() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (/mode\s*!==\s*option\.value\s*\|\|\s*option\.value\s*===\s*["'`]plan["'`]/.test(source)) {
    throw new Error("active Plan mode switch still re-sends plan-on and can reset plan state");
  }
}

function assertAssistantPlanSummaryCannotSelfComplete() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (!source.includes('type !== "assistant-plan-summary" && isPlanCompleteText')) {
    throw new Error("assistant plan summaries can still be marked complete by incidental text");
  }
}

function assertPlanCompletionNeedsWholePlanSignal() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function isPlanCompleteText"), source.indexOf("function isAssistantPlanMessage"));
  const withoutNumberedWholePlan = body.split("\\b\\d+\\s+ad[ıi]m\\s+tamamland[ıi]\\b").join("");
  if (withoutNumberedWholePlan.includes("ad[ıi]m\\s+tamamland") || !body.includes("tüm|bütün") || !body.includes("\\d+\\s+ad[ıi]m")) {
    throw new Error("Plan completion detection can still treat one completed step as the whole plan");
  }
}

function assertPendingPlanDecisionMarksPlanReady() {
  const source = readFileSync(new URL("../src/server/runtime.ts", import.meta.url), "utf8");
  if (!source.includes("hasPendingDecision") || !source.includes("args.hasPendingDecision")) {
    throw new Error("plan state can still report planning while a Plan decision is already pending");
  }
}

function assertPlanClarificationBlocksAreHiddenFromChat() {
  const source = readFileSync(new URL("../src/client/src/lib/render.ts", import.meta.url), "utf8");
  if (!source.includes("stripPlanClarificationBlocks") || !source.includes("<plan-clarification>")) {
    throw new Error("agent plan clarification JSON can still leak into chat rendering");
  }
}

function assertInternalPlanTriggerMessagesAreHiddenFromChat() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const selectorSource = source.slice(source.indexOf("function selectTimelineVisibleMessages"), source.indexOf("function selectTimelineToolsView"));
  if (
    !source.includes("function isHiddenTimelineMessage") ||
    !selectorSource.includes("isHiddenTimelineMessage(message)") ||
    !source.includes("isHiddenTimelineMessage(streamingMessage)") ||
    !source.includes("message?.display === false") ||
    !source.includes('type === "plan-mode-trigger"') ||
    !source.includes('type === "plan-mode-context"') ||
    !source.includes('type === "ambient-todo-context"') ||
    !source.includes('type === "plan-mode-execute"')
  ) {
    throw new Error("internal Plan trigger/context messages can still leak into the chat timeline");
  }
}

function assertPlanExecutionRunsAsSingleAgentTurn() {
  const source = readFileSync(new URL("../../../packages/coding-agent/src/bundled/extensions/plan-mode/index.ts", import.meta.url), "utf8");
  if (
    source.includes("sendExecutionContinuation") ||
    source.includes("executionAutoContinue") ||
    source.includes("adımdan devam et") ||
    !source.includes("Execute all remaining steps in this same turn") ||
    !source.includes("Do not stop after one step") ||
    !source.includes("Onaylanan planı tek akışta uygula")
  ) {
    throw new Error("Plan execution can still fall back to hidden step-by-step continuation prompts");
  }
}

function assertStreamingExecutionProgressFeedsPlanPanel() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (
    !source.includes("streamingExecutionText") ||
    !source.includes("applyStreamingExecutionProgress") ||
    !source.includes('extractPlanMarkerSteps(text, "DONE")') ||
    !source.includes('extractLastPlanMarkerStep(text, "ACTIVE")') ||
    !source.includes("step < activeStep")
  ) {
    throw new Error("streaming execution markers are not reflected in the Plan panel before server final state");
  }
}

function assertPromptConversationModeIsBidirectional() {
  const serverSource = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../src/server/runtime.ts", import.meta.url), "utf8");
  if (
    !serverSource.includes("runtime.applyConversationMode(command.conversationMode)") ||
    !runtimeSource.includes("applyConversationMode") ||
    !runtimeSource.includes('mode === "plan"') ||
    !runtimeSource.includes('plan.enabled && !plan.executing') ||
    !runtimeSource.includes("await this.setPlanMode(false)")
  ) {
    throw new Error("prompt conversationMode snapshot is still only applied when entering Plan mode");
  }
}

function assertApplyPlanDecisionSwitchesComposerToExecute() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const resolveSource = source.slice(source.indexOf("async function resolvePlanDecision"), source.indexOf("async function answerPlanClarification"));
  if (
    !source.includes("function planDecisionComposerMode") ||
    !source.includes('return planDecisionLabel(option) === "Uygula" ? "execute" : "plan"') ||
    !resolveSource.includes("const nextComposerMode = planDecisionComposerMode(value)") ||
    !resolveSource.includes("setComposerMode(nextComposerMode)") ||
    !resolveSource.includes('writeStorageValue("quake-web:composerMode", nextComposerMode)')
  ) {
    throw new Error("Plan Apply decision can still leave the composer in Plan mode");
  }
}

function assertComposerApplyDoesNotDisableActivePlanFlow() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const switchSource = source.slice(source.indexOf("async function switchComposerMode"), source.indexOf("async function resolvePlanDecision"));
  if (
    !source.includes("function isActivePlanFlow") ||
    !source.includes('plan?.phase === "complete" && !plan?.executing') ||
    !switchSource.includes('mode === "execute" && isPlanMode && visiblePlanDecision') ||
    !switchSource.includes('await resolvePlanDecision("Uygula")') ||
    !switchSource.includes('mode === "execute" && isPlanMode && pendingPlanClarification') ||
    !switchSource.includes("isActivePlanFlow(displayPlanState, store.state?.isStreaming)") ||
    !switchSource.includes("Plan soruları tamamlanmadan uygulamaya geçilmez.") ||
    !switchSource.includes("Plan hazır olunca Uygula kararı panelde görünecek.")
  ) {
    throw new Error("composer Uygula can still disable or corrupt an active Plan flow");
  }
}

function assertPendingPlanInteractionCanBeCancelledBeforeRuntimeLock() {
  const serverSource = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../src/server/runtime.ts", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../src/server/web-extension-ui.ts", import.meta.url), "utf8");
  const extensionSource = readFileSync(new URL("../../../packages/coding-agent/src/bundled/extensions/plan-mode/index.ts", import.meta.url), "utf8");
  if (!serverSource.includes("runtime.cancelPendingInteractions();") || serverSource.indexOf("runtime.cancelPendingInteractions();") > serverSource.indexOf("runtimeLock.run")) {
    throw new Error("session-changing commands can still wait behind a pending Plan clarification lock");
  }
  if (!runtimeSource.includes("cancelPendingInteractions()") || !runtimeSource.includes("this.extensionUi.clearPendingRequests()")) {
    throw new Error("runtime cannot cancel pending Plan interactions before session changes");
  }
  if (!bridgeSource.includes('status: "cancelled"') || !bridgeSource.includes("cancelled: true")) {
    throw new Error("pending extension UI requests do not resolve with a cancellation sentinel");
  }
  if (!extensionSource.includes('status: "cancelled"') || !extensionSource.includes('result.status === "cancelled"')) {
    throw new Error("plan-mode can still continue with default assumptions after a cancelled clarification");
  }
}

function assertPlanUiResponsesBypassRuntimeLock() {
  const source = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");
  const lockIndex = source.indexOf("runtimeLock.run");
  for (const token of [
    'case "plan_decision":',
    'case "plan_refine":',
    'case "plan_clarification_complete":',
    'case "plan_clarification_skip":',
  ]) {
    const index = source.indexOf(token);
    if (index < 0 || index > lockIndex) {
      throw new Error(`${token} can still be queued behind the runtime lock while the agent is waiting for UI input`);
    }
  }
}

function assertPlanClarificationDefaultFlagSurvivesSync() {
  const clientSource = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");
  const protocolSource = readFileSync(new URL("../src/shared/protocol.ts", import.meta.url), "utf8");
  if (
    !clientSource.includes("skipped: args.answer.skipped") ||
    !serverSource.includes("skipped: command.skipped") ||
    !protocolSource.includes("skipped?: boolean")
  ) {
    throw new Error("Plan clarification default answer can still lose its skipped/default marker during state sync");
  }
}

function assertPlanCompletionStopsComposerStreamingBadge() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (!source.includes("isComposerStreaming") || !source.includes('sessionPlan?.phase !== "complete"') || !source.includes("!hasPendingPlanDecision")) {
    throw new Error("composer can still show a stale streaming badge after Plan completion or while a Plan decision is waiting");
  }
}

function assertExecutionCompletionHasTextFallback() {
  const source = readFileSync(new URL("../../../packages/coding-agent/src/bundled/extensions/plan-mode/index.ts", import.meta.url), "utf8");
  if (!source.includes("shouldFinalizeExecutionFromText") || !source.includes("for (const item of todoItems) item.completed = true")) {
    throw new Error("execution checklist can still stay partially complete when the assistant finishes without DONE markers");
  }
}

function assertTurkishPlanPromptAvoidsEnglishVerificationHeading() {
  const source = readFileSync(new URL("../../../packages/coding-agent/src/bundled/extensions/plan-mode/index.ts", import.meta.url), "utf8");
  if (!source.includes("doğrulama bulguları") || !source.includes("reasoning summaries Turkish")) {
    throw new Error("Turkish Plan Mode can still produce English verification headings");
  }
}

function assertNewSessionClearsPendingPlanUi() {
  const clientSource = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../src/server/web-extension-ui.ts", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../src/server/runtime.ts", import.meta.url), "utf8");
  if (!clientSource.includes("clearPlanUiSurface({ switchPanel: true, resetMode: true })")) {
    throw new Error("new session can still leave the composer stuck in Plan mode");
  }
  if (!clientSource.includes('writeStorageValue("quake-web:composerMode", "execute")')) {
    throw new Error("Plan mode preference is not reset when stale Plan UI is cleared");
  }
  if (!clientSource.includes("isPlanSurfaceToast") || !clientSource.includes("store.toasts.filter((toast) => !isPlanSurfaceToast(toast))")) {
    throw new Error("new session can still leave stale Plan mode toasts visible");
  }
  if (!bridgeSource.includes("clearPendingRequests(")) {
    throw new Error("web extension UI bridge cannot clear stale pending Plan UI requests");
  }
  if (!runtimeSource.includes("this.extensionUi.clearPendingRequests()")) {
    throw new Error("new/switch session can still carry stale pending Plan UI requests");
  }
}

function assertPlanClarificationProtocolAndUi() {
  const sources = [
    readFileSync(new URL("../src/shared/protocol.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/client/src/components/plan/PlanQuestionsPanel.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../../../packages/coding-agent/src/bundled/extensions/plan-mode/index.ts", import.meta.url), "utf8"),
  ].join("\n");
  for (const token of [
    "plan_clarification_complete",
    "plan_clarification_skip",
    "QuestionsCard",
    "planClarification",
    "Planı netleştirelim",
  ]) {
    if (!sources.includes(token)) throw new Error(`plan clarification feature is missing ${token}`);
  }
  if (/Ask concise clarifying questions in your response when requirements are ambiguous/.test(sources)) {
    throw new Error("plan clarification still tells the model to dump questions into chat");
  }
}

function assertTimelineToolHistoryIsWindowed() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (/buildMessageToolHistory\(messages\)/.test(source) || !source.includes("TIMELINE_HISTORY_SCAN_LIMIT") || !source.includes("timelineHistoryMessages")) {
    throw new Error("timeline tool history still scans the full message log instead of a bounded visible window");
  }
}

function assertToolsPanelIsWindowed() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (/groupToolsByTurn\(filtered\)/.test(source) || !source.includes("TOOL_PANEL_INITIAL_WINDOW") || !source.includes("visibleTools")) {
    throw new Error("tools panel still renders every matching tool instead of a bounded visible window");
  }
}

function assertChangeSummariesAreWindowed() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (/summarizeComposerChanges\(toolCards\)/.test(source) || /extractFileChanges\(tools\)\.slice/.test(source) || !source.includes("CHANGE_TOOL_SCAN_LIMIT") || !source.includes("selectRecentToolsForChanges")) {
    throw new Error("composer and changed-files summaries still scan the full tool history");
  }
}

function assertApiErrorsAreLocalized() {
  const source = readFileSync(new URL("../src/client/src/lib/api.ts", import.meta.url), "utf8");
  if (source.includes("${res.status} ${res.statusText}") || source.includes("statusText")) {
    throw new Error("API client still exposes raw HTTP statusText fallback in user-facing errors");
  }
}

function assertTimelineMessageModeSkipsToolSubscription() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const timelineSource = source.slice(source.indexOf("function LiveTimeline"), source.indexOf("function TimelineToolCard"));
  if (/useAppStore\(\(s\)\s*=>\s*s\.tools\)/.test(timelineSource) || !source.includes("EMPTY_TOOL_STATE") || !timelineSource.includes('filter === "messages" ? EMPTY_TOOL_STATE : state.tools')) {
    throw new Error("timeline message mode still subscribes to the full tool store");
  }
}

function assertTimelineVisibleMessagesAreWindowed() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  // TypewriterMarkdown removed — LiveTimeline ends at selectTimelineVisibleMessages.
  const start = source.indexOf("function LiveTimeline");
  const end = source.indexOf("function selectTimelineVisibleMessages");
  const timelineSource = start >= 0 && end > start ? source.slice(start, end) : source;
  if (/messages\.filter\(\(m\)\s*=>\s*m\?\.role\s*!==\s*["']toolResult["']\)/.test(timelineSource) || !source.includes("selectTimelineVisibleMessages") || !timelineSource.includes("visibleSelection")) {
    throw new Error("timeline still materializes the full visible message list before windowing");
  }
}

function assertTimelineToolsAvoidFullToolArray() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function LiveTimeline");
  const end = source.indexOf("function selectTimelineVisibleMessages");
  const timelineSource = start >= 0 && end > start ? source.slice(start, end) : source;
  if (timelineSource.includes("Object.values(toolState)") || timelineSource.includes("filteredTools") || !source.includes("selectTimelineToolsView")) {
    throw new Error("timeline still allocates the full tool array before selecting the visible tool window");
  }
}

function assertMarkdownToolNoticeSelectionIsBounded() {
  const source = readFileSync(new URL("../src/client/src/components/markdown/MarkdownMessage.tsx", import.meta.url), "utf8");
  const selectorSource = source.slice(source.indexOf("function selectNoticeLiveTools"), source.indexOf("function isActiveTool"));
  const noticeSource = source.slice(source.indexOf("function ToolCallNotice("), source.indexOf("function isActiveTool"));
  if (
    selectorSource.includes("Object.values(toolMap)") ||
    noticeSource.includes("allTools.filter") ||
    noticeSource.includes(".sort((a, b)") ||
    !source.includes("NOTICE_LIVE_TOOL_LIMIT") ||
    !source.includes("selectToolNoticeView") ||
    !selectorSource.includes("pushBoundedLiveTool")
  ) {
    throw new Error("markdown tool notices still allocate the full tool map for every live notice");
  }
}

function assertMarkdownToolBatchSummaryIsSinglePass() {
  const source = readFileSync(new URL("../src/client/src/components/markdown/MarkdownMessage.tsx", import.meta.url), "utf8");
  const summarySource = source.slice(source.indexOf("function summarizeToolBatch"), source.indexOf("function summarizeToolArgs"));
  if (
    summarySource.includes("tools.map(") ||
    summarySource.includes("names.filter(") ||
    summarySource.includes("tools.filter(") ||
    summarySource.includes("const count =") ||
    !source.includes("collectToolBatchSummary(")
  ) {
    throw new Error("markdown tool notice summaries still rescan every tool/name category separately");
  }
}

function assertMarkdownToolLineStatsAvoidLargeSplits() {
  const source = readFileSync(new URL("../src/client/src/components/markdown/MarkdownMessage.tsx", import.meta.url), "utf8");
  const statsSource = source.slice(source.indexOf("function diffLineStats"), source.indexOf("function toolRunActionLabel"));
  if (
    statsSource.includes(".split(\"\\n\")") ||
    statsSource.includes(".split('\\n')") ||
    statsSource.includes(".split(/\\n") ||
    !source.includes("scanTextLines(") ||
    !source.includes("countTextLines(")
  ) {
    throw new Error("markdown tool line stats still split large patch/content strings into arrays");
  }
}

function assertMarkdownToolPreviewsAvoidLargeSplits() {
  const source = readFileSync(new URL("../src/client/src/components/markdown/MarkdownMessage.tsx", import.meta.url), "utf8");
  const previewSource = source.slice(source.indexOf("function toolExecutionPreview"), source.indexOf("function extractWrittenPath"));
  if (
    previewSource.includes(".split(\"\\n\")") ||
    previewSource.includes(".split('\\n')") ||
    previewSource.includes("chunks.join(\"\\n\\n\")") ||
    previewSource.includes(".replace(/\\r\\n/g, \"\\n\")") ||
    !source.includes("appendPreviewBlock(") ||
    !source.includes("collectPreviewLines(")
  ) {
    throw new Error("markdown expanded tool previews still split or join large output strings wholesale");
  }
}

function assertMarkdownToolOutputPreviewIsBounded() {
  const source = readFileSync(new URL("../src/client/src/components/markdown/MarkdownMessage.tsx", import.meta.url), "utf8");
  const executionSource = source.slice(source.indexOf("function toolExecutionPreview"), source.indexOf("const toolPreviewLanguageCache"));
  if (
    executionSource.includes("stripAnsi(String(tool.output") ||
    executionSource.includes("formatToolOutputPreview(output)") ||
    source.includes("function formatToolOutputPreview") ||
    !source.includes("boundedToolOutputPreview(")
  ) {
    throw new Error("markdown tool output preview still normalizes the full output string before windowing");
  }
}

function assertStreamingUsesMarkdownMessage() {
  // TypewriterMarkdown removed in favor of streamdown MarkdownMessage (streaming mode).
  const main = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const markdown = readFileSync(new URL("../src/client/src/components/markdown/MarkdownMessage.tsx", import.meta.url), "utf8");
  if (main.includes("<TypewriterMarkdown") || main.includes("function TypewriterMarkdown")) {
    throw new Error("legacy TypewriterMarkdown is still referenced");
  }
  if (!markdown.includes('from "streamdown"') || !markdown.includes('mode={isStreaming ? "streaming" : "static"}')) {
    throw new Error("MarkdownMessage is not using streamdown streaming mode");
  }
}

function assertChangeSummariesAvoidFullToolArray() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  if (source.includes("Object.values(store.tools)") || source.includes("selectRecentToolsForChanges(Object.values(toolMap))") || !source.includes("selectRecentToolsForChangesFromMap")) {
    throw new Error("composer/change summaries still allocate the full tool array before bounded selection");
  }
}

function assertToolsPanelAvoidsFullToolSort() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const panelSource = source.slice(source.indexOf("function ToolsPanel"), source.indexOf("function ToolTurnGroup"));
  if (panelSource.includes("Object.values(toolMap)") || panelSource.includes("sortToolsByRecency(") || !source.includes("selectToolsPanelView")) {
    throw new Error("tools panel still sorts the full tool history before windowing");
  }
}

function assertToolGroupingAvoidsArrayCopyChurn() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const groupSource = source.slice(source.indexOf("function groupToolsByTurn"), source.indexOf("function ToolCard"));
  if (groupSource.includes("...(map.get(key)") || groupSource.includes("turnTools.filter") || groupSource.includes("turnTools.map") || !source.includes("createToolTurnSummary")) {
    throw new Error("tool turn grouping still copies arrays or scans each group multiple times");
  }
}

function assertPatchSummariesAvoidRepeatedSplits() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const summarySource = source.slice(source.indexOf("function summarizePatch"), source.indexOf("function ToolsPanel"));
  if (summarySource.includes(".split(\"\\n\").filter") || summarySource.split(".split(\"\\n\")").length > 2 || !source.includes("scanPatchSummary(")) {
    throw new Error("patch summaries still split and scan large patch text repeatedly");
  }
}

function assertAppStorePrunesToolsWithoutFullSort() {
  const source = readFileSync(new URL("../src/client/src/state/app-store.ts", import.meta.url), "utf8");
  const pruneSource = source.slice(source.indexOf("function pruneTools"), source.indexOf("function compactToolOutput"));
  if (pruneSource.includes("Object.values(tools)") || pruneSource.includes(".filter((tool)") || pruneSource.includes(".sort((a, b)") || !source.includes("pushPrunedToolBounded")) {
    throw new Error("app store tool pruning still allocates and sorts the full tool history");
  }
}

function assertAppStoreNormalizesMessagesInSinglePass() {
  const source = readFileSync(new URL("../src/client/src/state/app-store.ts", import.meta.url), "utf8");
  const storeSource = source.slice(source.indexOf("export const useAppStore"), source.indexOf("upsertTool:"));
  if (storeSource.includes("[...state.messages, message]") || storeSource.includes("countVisibleMessages(messages)") || !source.includes("normalizeMessages(")) {
    throw new Error("app store still normalizes messages with extra array copies or a second visible-count scan");
  }
}

function assertReadyEventCountsAssistantTurnsWithoutFilterAllocation() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const handlerSource = source.slice(source.indexOf("function handleServerEvent"), source.indexOf("function handleServerMessage"));
  if (handlerSource.includes(".filter((message: any) => message?.role === \"assistant\")") || !source.includes("countAssistantTurns(")) {
    throw new Error("ready event still counts assistant turns by allocating a filtered message array");
  }
}

function assertAppShellUsesVisibleMessageCount() {
  const source = readFileSync(new URL("../src/client/src/main.tsx", import.meta.url), "utf8");
  const storeSource = readFileSync(new URL("../src/client/src/state/app-store.ts", import.meta.url), "utf8");
  if (source.includes("store.messages.some") || !source.includes("store.visibleMessageCount") || !storeSource.includes("normalizeMessages")) {
    throw new Error("app shell still scans the full message log to decide empty-chat state");
  }
}

function assertCommandPaletteSearchIsBounded() {
  const source = readFileSync(new URL("../src/client/src/components/command/CommandPalette.tsx", import.meta.url), "utf8");
  if (source.includes("files.filter((entry") || source.includes(".sort((a, b) => b.score") || !source.includes("pushPaletteScoreBounded")) {
    throw new Error("command palette still filters or sorts large candidate lists wholesale");
  }
}

function assertFilesPanelTreeIsWindowedBeforeMaterializing() {
  const panelSource = readFileSync(new URL("../src/client/src/components/files/FilesPanel.tsx", import.meta.url), "utf8");
  const treeSource = readFileSync(new URL("../src/client/src/components/files/file-tree.ts", import.meta.url), "utf8");
  const source = `${panelSource}\n${treeSource}`;
  if (source.includes("flattenVisibleTree(") || source.includes("visibleTreeRows.slice") || !source.includes("selectVisibleTreeRows") || !treeSource.includes("rows.length < limit")) {
    throw new Error("files panel still materializes the full visible tree before windowing");
  }
}

function assertSessionsPanelSearchIsBounded() {
  const source = readFileSync(new URL("../src/client/src/components/sessions/SessionsPanel.tsx", import.meta.url), "utf8");
  if (source.includes("sessions.filter((session") || source.includes("[...visible].sort") || source.includes("ordered.slice") || !source.includes("selectSessionPanelView")) {
    throw new Error("sessions panel still filters and sorts the full session list before windowing");
  }
}

async function waitForReady() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready\n${serverOutput}`);
}

async function assertNoVisualLeaks(page, label) {
  const visualState = await page.evaluate(() => ({
    closedDetailsLeaking: [...document.querySelectorAll("details:not([open]) > :not(summary)")].some((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && rect.height > 0;
    }),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  if (visualState.closedDetailsLeaking) throw new Error(`${label}: closed details content is taking layout space`);
  if (visualState.overflowX) throw new Error(`${label}: page has horizontal overflow`);
}

async function assertComposerErgonomics(page, label) {
  const state = await page.evaluate(() => {
    const composer = document.querySelector("#composer");
    const prompt = document.querySelector("#prompt");
    if (!(composer instanceof HTMLElement) || !(prompt instanceof HTMLElement)) {
      return { missing: true };
    }
    const composerRect = composer.getBoundingClientRect();
    const promptRect = prompt.getBoundingClientRect();
    const promptCenterX = Math.min(Math.max(promptRect.left + promptRect.width / 2, 0), window.innerWidth - 1);
    const promptCenterY = Math.min(Math.max(promptRect.top + promptRect.height / 2, 0), window.innerHeight - 1);
    const hitTarget = document.elementFromPoint(promptCenterX, promptCenterY);
    return {
      missing: false,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      composerRect: {
        left: composerRect.left,
        right: composerRect.right,
        top: composerRect.top,
        bottom: composerRect.bottom,
        width: composerRect.width,
        height: composerRect.height,
      },
      promptRect: {
        left: promptRect.left,
        right: promptRect.right,
        top: promptRect.top,
        bottom: promptRect.bottom,
        width: promptRect.width,
        height: promptRect.height,
      },
      promptCenterIsUsable: hitTarget === prompt || prompt.contains(hitTarget) || composer.contains(hitTarget),
    };
  });

  if (state.missing) throw new Error(`${label}: composer or prompt is missing`);
  const { composerRect, promptRect, viewportWidth, viewportHeight } = state;
  if (composerRect.left < -1 || composerRect.right > viewportWidth + 1) throw new Error(`${label}: composer is outside viewport horizontally`);
  if (composerRect.top < -1 || composerRect.bottom > viewportHeight + 1) throw new Error(`${label}: composer is outside viewport vertically`);
  if (promptRect.left < composerRect.left - 1 || promptRect.right > composerRect.right + 1) throw new Error(`${label}: prompt escapes composer bounds`);
  if (promptRect.width < Math.min(180, viewportWidth * 0.42)) throw new Error(`${label}: prompt is too narrow for comfortable typing`);
  if (!state.promptCenterIsUsable) throw new Error(`${label}: prompt center is covered by another layer`);
}
