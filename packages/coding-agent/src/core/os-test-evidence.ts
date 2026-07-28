import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.js";

export interface OsTestEvidence {
	id: string;
	timestamp: string;
	mode: string;
	steps: any[];
	verdict: "pass" | "fail" | "error";
	screenshots: string[];
}

export class OsTestEvidenceManager {
	private testDir: string;

	constructor() {
		this.testDir = join(getAgentDir(), "tests", "os-verification");
		mkdirSync(this.testDir, { recursive: true });
	}

	createSessionDir(mode: string): string {
		const sessionId = `${new Date().toISOString().replace(/[.:]/g, "-")}_${mode}`;
		const sessionPath = join(this.testDir, sessionId);
		mkdirSync(sessionPath, { recursive: true });
		return sessionPath;
	}

	saveEvidence(sessionPath: string, evidence: OsTestEvidence): void {
		const filePath = join(sessionPath, "evidence.json");
		writeFileSync(filePath, JSON.stringify(evidence, null, 2));
	}

	saveScreenshot(sessionPath: string, stepIndex: number, base64Data: string): string {
		const fileName = `step_${stepIndex}_visual.png`;
		const filePath = join(sessionPath, fileName);
		writeFileSync(filePath, Buffer.from(base64Data, "base64"));
		return fileName;
	}
}
