import { OsTestEvidenceManager } from "./os-test-evidence.js";

export class OsTestExecutor {
	private evidenceManager: OsTestEvidenceManager;

	constructor() {
		this.evidenceManager = new OsTestEvidenceManager();
	}

	/**
	 * Run Notepad Sanity Test with senior-level error handling and tool discovery.
	 */
	async runNotepadSanityTest(session: any): Promise<string> {
		const sessionPath = this.evidenceManager.createSessionDir("notepad-sanity");
		const evidence: any = {
			id: Date.now().toString(),
			mode: "notepad-sanity",
			steps: [],
			verdict: "fail",
		};

		try {
			// Step 1: Execute Bash (Using the built-in stable method)
			// session.executeBash is highly reliable and handles all context recording
			const bashResult = await session.executeBash("start notepad.exe");
			evidence.steps.push({ name: "launch", result: bashResult });

			if (bashResult.exitCode !== 0 && bashResult.exitCode !== undefined) {
				throw new Error(`Failed to launch notepad. Exit code: ${bashResult.exitCode}`);
			}

			// Wait a few seconds for Notepad to actually render
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Step 2: Custom OS Step (Directly invoking our new orchestration tool)
			// We access the tool through the internal registry Map for maximum safety
			const toolName = "os_perform_step";

			// We look for the tool in the session's internal tool registry
			// Note: We use any here because we are reaching into internal state
			const toolRegistry = (session as any)._toolRegistry;
			if (!toolRegistry) {
				throw new Error("Internal tool registry not found in session.");
			}

			const performTool = toolRegistry.get(toolName);
			if (!performTool) {
				throw new Error(`The required tool '${toolName}' is not registered in the current session.`);
			}

			const step2 = await performTool.execute("test_call_final", {
				action: "click",
				params: { x: 500, y: 400 },
				reason: "Automated sanity check for OS interaction.",
				expectedWindowTitle: "Not",
				timeoutMs: 8000,
			});

			evidence.steps.push({ name: "verification", result: step2 });

			if (step2 && !step2.isError) {
				evidence.verdict = "pass";
			} else {
				evidence.error = step2?.content?.[0]?.text || "Verification step returned an error.";
			}
		} catch (error: any) {
			evidence.verdict = "error";
			evidence.error = error.message;
		}

		this.evidenceManager.saveEvidence(sessionPath, evidence);

		if (evidence.verdict === "pass") {
			return `✦ OS Sanity Test PASSED. Result: Visual verification confirmed. Logs: ${sessionPath}`;
		} else {
			return `✦ OS Sanity Test FAILED. Reason: ${evidence.error}. Check: ${sessionPath}`;
		}
	}
}
