/**
 * Manual visual test for assistant message rail.
 * Rise animation (bottom-up) is currently disabled.
 * Run: npx tsx test/rail-animation-debug.ts
 */

import type { AssistantMessage } from "@mrquake/quakecode-ai";
import { Container, ProcessTerminal, Spacer, Text, TUI } from "@mrquake/quakecode-tui";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

process.env.COLORTERM = "truecolor";
initTheme("grok-build");

const LINES = [
	"Mor rail animasyonu testi — birinci satir.",
	"Ikinci satir alttan yukari belirmeli.",
	"Ucuncu satir en son gorunmeli.",
	"Dorduncu satir: sol tarafta gri │ ve mor ▁▂▃▄▅▆▇█ kenari.",
	"Besinci satir: stream sirasinda mor █ cursor yanip soner.",
];

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);
	const root = new Container();

	root.addChild(new Spacer(1));
	root.addChild(new Text("Rail animation debug — watch the LEFT gutter while lines appear.", 1, 0));
	root.addChild(new Spacer(1));

	const message = { role: "assistant", content: [{ type: "text", text: "" }] } as AssistantMessage;
	const component = new AssistantMessageComponent(message, true, undefined, "Thinking...", {
		requestRender: () => tui.requestRender(),
	});
	root.addChild(component);
	tui.addChild(root);
	tui.start();

	let buffer = "";
	for (let i = 0; i < LINES.length; i++) {
		buffer = i === 0 ? LINES[i]! : `${buffer}\n${LINES[i]!}`;
		component.updateContent({
			role: "assistant",
			content: [{ type: "text", text: buffer }],
		} as AssistantMessage);
		tui.requestRender();
		await sleep(900);
	}

	await sleep(3500);
	tui.stop();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
