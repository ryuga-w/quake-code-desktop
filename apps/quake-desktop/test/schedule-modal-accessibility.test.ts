import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const appShellSource = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
const focusTrapSource = readFileSync(join(root, "src/client/src/lib/modal-focus.ts"), "utf8");

describe("schedule modal accessibility", () => {
  it("activates the shared focus trap only while the dialog is open", () => {
    expect(appShellSource).toContain('import { useModalFocusTrap } from "../lib/modal-focus"');
    expect(appShellSource).toContain("useModalFocusTrap<HTMLDivElement>(scheduleOpen)");
    expect(appShellSource).toContain("ref={scheduleDialogRef}");
    expect(appShellSource).toContain("tabIndex={-1}");
  });

  it("closes on Escape without leaking the key to the application shell", () => {
    expect(appShellSource).toContain("handleScheduleDialogKeyDown");
    expect(appShellSource).toContain('event.key !== "Escape"');
    expect(appShellSource).toContain("event.preventDefault()");
    expect(appShellSource).toContain("event.stopPropagation()");
    expect(appShellSource).toContain("closeScheduleDialog()");
    expect(appShellSource).toContain("onKeyDown={handleScheduleDialogKeyDown}");
  });

  it("uses a stable accessible title", () => {
    expect(appShellSource).toContain('aria-labelledby="schedule-dialog-title"');
    expect(appShellSource).toContain('id="schedule-dialog-title"');
    expect(appShellSource).not.toContain('role="dialog" aria-modal="true" aria-label="Zamanlananlar"');
  });

  it("inherits focus restoration from the shared modal hook", () => {
    expect(focusTrapSource).toContain("const previous = document.activeElement instanceof HTMLElement");
    expect(focusTrapSource).toContain("if (previous && document.contains(previous))");
    expect(focusTrapSource).toContain("previous.focus({ preventScroll: true })");
  });
});
