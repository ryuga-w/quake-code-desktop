import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const main = readFileSync(join(root, "src/client/src/app/App.tsx"), "utf8");
const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
const timeline = readFileSync(join(root, "src/client/src/components/timeline/Timeline.tsx"), "utf8");
const timelineLogic = readFileSync(join(root, "src/client/src/components/timeline/timeline-logic.ts"), "utf8");
const questions = readFileSync(join(root, "src/client/src/components/plan/PlanQuestionsPanel.tsx"), "utf8");
const artifactPanel = readFileSync(join(root, "src/client/src/components/plan/PlanArtifactPanel.tsx"), "utf8");
const approval = readFileSync(join(root, "src/client/src/components/plan/PlanApprovalCard.tsx"), "utf8");
const composer = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.tsx"), "utf8");
const composerStyles = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.module.css"), "utf8");
const runtime = readFileSync(join(root, "src/server/runtime.ts"), "utf8");
const protocol = readFileSync(join(root, "src/shared/protocol.ts"), "utf8");
const extension = readFileSync(join(root, "../../packages/coding-agent/src/bundled/extensions/plan-mode/index.ts"), "utf8");
const agentSession = readFileSync(join(root, "../../packages/coding-agent/src/core/agent-session.ts"), "utf8");

describe("Codex-compatible plan contracts", () => {
  it("separates update_plan from Plan mode", () => {
    // update_plan is a core builtin (Codex PlanHandler); Plan mode must not re-register it.
    expect(extension).toContain("update_plan is a **core builtin**");
    expect(extension).toContain("Do not re-register here");
    expect(extension).toContain('name: "request_user_input"');
    expect(extension).toContain('if (!active.includes("update_plan")) active.push("update_plan")');
    expect(extension).not.toContain('name: "plan_progress"');
    expect(extension).not.toContain('name: "plan_add_step"');
  });

  it("uses collaboration mode instead of the legacy execution state machine", () => {
    expect(runtime).toContain("this.session.collaborationMode === \"plan\"");
    expect(runtime).toContain('customType === "plan-item"');
    expect(runtime).not.toContain("executePersistedPlan");
    expect(runtime).not.toContain("resumePersistedPlan");
    expect(protocol).not.toContain("plan_execute_persisted");
    expect(protocol).not.toContain("plan_resume");
  });

  it("streams proposed plans as dedicated item events", () => {
    expect(agentSession).toContain('type: "item/started"');
    expect(agentSession).toContain('type: "item/plan/delta"');
    expect(agentSession).toContain('type: "item/completed"');
    expect(agentSession).toContain("stripProposedPlanBlocks");
    expect(agentSession).toContain('appendCustomEntry("plan-item"');
  });

  it("renders Proposed Plan and Updated Plan without execution controls", () => {
    // Baslik plan durumuna gore dinamik: oneri asamasinda proposedPlan, uygulandiysa appliedPlan.
    expect(artifactPanel).toContain('t("runtime.plan.proposedPlan")');
    expect(artifactPanel).toContain('t("runtime.plan.appliedPlan")');
    expect(artifactPanel).toContain('aria-label={title}');
    expect(artifactPanel).toContain('aria-label={t("runtime.plan.updatedPlan")}');
    expect(artifactPanel).toContain("plan.steps.map");
    // Panel salt-goruntuleme: plan uygulama AKSIYONU (buton/handler) icermemeli.
    // ("Uygulanan plan" durum etiketi bir aksiyon degil, o yuzden metni degil handler'i kontrol et.)
    expect(artifactPanel).not.toContain("applyPlan");
    expect(artifactPanel).not.toContain("onApply");
    expect(artifactPanel).not.toContain("onResume");
    expect(artifactPanel).not.toContain("onAddTodo");
  });

  it("renders update_plan progress as a compact hover pill above the composer", () => {
    expect(composer).toContain("<ComposerPlanPill");
    expect(composer).toContain('plan?.steps.some((step) => !step.completed && step.status !== "completed")');
    expect(composer).toContain('step.completed || step.status === "completed"');
    expect(composer).toContain("if (complete) return null");
    expect(composer).toContain('t("composer.plan.progress")');
    expect(composer).toContain('t("composer.plan.progressText", { current: currentStep, total })');
    expect(composer).toContain("plan.steps.map");
    expect(composer).toContain("planPillStepList");
    expect(composer).toContain("planPillSpinner");
    expect(composerStyles).toContain(".planPill");
    expect(composerStyles).toContain(".planPill:hover .planPillDetail");
    expect(composerStyles).toContain(".planPillStepList");
    expect(composerStyles).toContain("@keyframes planPillFill");
    expect(shell).toContain("plan={sessionPlan}");
    expect(timelineLogic).toContain("isPlanProtocolToolName(tool.toolName)");
  });

  it("keeps the final Created Plan card in chat", () => {
    expect(timeline).toContain('customType === "plan-created"');
    expect(timeline).toContain("<CreatedPlanCard");
    expect(timeline).toContain("markdown={markdown}");
  });

  it("offers Codex-style apply or revise actions when a plan is ready", () => {
    expect(shell).toContain("<PlanApprovalCard");
    expect(main).toContain('conversationMode: "execute"');
    expect(main).toContain("reviseReadyPlan");
    // Görünür metinler i18n'e taşındı.
    expect(approval).toContain('t("runtime.plan.applyQuestion")');
    expect(approval).toContain('t("runtime.plan.apply")');
    expect(approval).toContain('t("runtime.plan.revise")');
  });

  it("switches composer modes directly", () => {
    expect(main).toContain('runUiCommand({ type: "set_plan_mode", enabled: enable }');
    expect(main).not.toContain("resolvePlanDecision");
    expect(main).not.toContain("plan_execute_persisted");
    expect(main).not.toContain("pendingDecision");
  });

  it("renders request_user_input through the Questions card", () => {
    expect(main).toContain('event.method === "requestUserInput"');
    expect(questions).toContain('t("runtime.plan.questions")');
    expect(questions).toContain('t("runtime.plan.other")');
    expect(questions).toContain("await onComplete");
  });
});
