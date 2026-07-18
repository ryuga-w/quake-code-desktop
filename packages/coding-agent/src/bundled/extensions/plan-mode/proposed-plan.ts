const OPEN_TAG = "<proposed_plan>";
const CLOSE_TAG = "</proposed_plan>";

export type ProposedPlanSegment =
	| { kind: "normal"; text: string }
	| { kind: "start" }
	| { kind: "delta"; text: string }
	| { kind: "end" };

export type ProposedPlanChunk = {
	visibleText: string;
	segments: ProposedPlanSegment[];
};

type TaggedLineSegment =
	| { kind: "normal"; text: string }
	| { kind: "tagStart" }
	| { kind: "tagDelta"; text: string }
	| { kind: "tagEnd" };

class TaggedLineParser {
	private activeTag = false;
	private detectTag = true;
	private lineBuffer = "";

	parse(delta: string): TaggedLineSegment[] {
		const segments: TaggedLineSegment[] = [];
		let run = "";
		for (const char of delta) {
			if (this.detectTag) {
				if (run) {
					this.pushText(run, segments);
					run = "";
				}
				this.lineBuffer += char;
				if (char === "\n") {
					this.finishLine(segments);
					continue;
				}
				const slug = this.lineBuffer.trimStart();
				const trimmed = slug.trimEnd();
				if (!trimmed || OPEN_TAG.startsWith(trimmed) || CLOSE_TAG.startsWith(trimmed)) continue;
				const buffered = this.lineBuffer;
				this.lineBuffer = "";
				this.detectTag = false;
				this.pushText(buffered, segments);
				continue;
			}
			run += char;
			if (char === "\n") {
				this.pushText(run, segments);
				run = "";
				this.detectTag = true;
			}
		}
		if (run) this.pushText(run, segments);
		return segments;
	}

	finish(): TaggedLineSegment[] {
		const segments: TaggedLineSegment[] = [];
		if (this.lineBuffer) {
			const buffered = this.lineBuffer;
			this.lineBuffer = "";
			const slug = buffered.trim();
			if (!this.activeTag && slug === OPEN_TAG) {
				segments.push({ kind: "tagStart" });
				this.activeTag = true;
			} else if (this.activeTag && slug === CLOSE_TAG) {
				segments.push({ kind: "tagEnd" });
				this.activeTag = false;
			} else {
				this.pushText(buffered, segments);
			}
		}
		if (this.activeTag) {
			segments.push({ kind: "tagEnd" });
			this.activeTag = false;
		}
		return segments;
	}

	private finishLine(segments: TaggedLineSegment[]): void {
		const line = this.lineBuffer;
		this.lineBuffer = "";
		const slug = line.endsWith("\n") ? line.slice(0, -1).trim() : line.trim();
		if (!this.activeTag && slug === OPEN_TAG) {
			segments.push({ kind: "tagStart" });
			this.activeTag = true;
		} else if (this.activeTag && slug === CLOSE_TAG) {
			segments.push({ kind: "tagEnd" });
			this.activeTag = false;
		} else {
			this.pushText(line, segments);
		}
		this.detectTag = true;
	}

	private pushText(text: string, segments: TaggedLineSegment[]): void {
		if (!text) return;
		const kind = this.activeTag ? "tagDelta" : "normal";
		const previous = segments.at(-1);
		if (previous?.kind === kind) previous.text += text;
		else segments.push({ kind, text } as TaggedLineSegment);
	}
}

function mapSegments(segments: TaggedLineSegment[]): ProposedPlanChunk {
	const output: ProposedPlanChunk = { visibleText: "", segments: [] };
	for (const segment of segments) {
		if (segment.kind === "normal") {
			output.visibleText += segment.text;
			output.segments.push({ kind: "normal", text: segment.text });
		} else if (segment.kind === "tagStart") output.segments.push({ kind: "start" });
		else if (segment.kind === "tagDelta") output.segments.push({ kind: "delta", text: segment.text });
		else output.segments.push({ kind: "end" });
	}
	return output;
}

export class ProposedPlanParser {
	private readonly parser = new TaggedLineParser();

	pushStr(chunk: string): ProposedPlanChunk {
		return mapSegments(this.parser.parse(chunk));
	}

	finish(): ProposedPlanChunk {
		return mapSegments(this.parser.finish());
	}
}

export function stripProposedPlanBlocks(text: string): string {
	const parser = new ProposedPlanParser();
	return parser.pushStr(text).visibleText + parser.finish().visibleText;
}

export function extractProposedPlanText(text: string): string | undefined {
	const parser = new ProposedPlanParser();
	let planText = "";
	let sawPlanBlock = false;
	for (const segment of [...parser.pushStr(text).segments, ...parser.finish().segments]) {
		if (segment.kind === "start") {
			sawPlanBlock = true;
			planText = "";
		} else if (segment.kind === "delta") {
			planText += segment.text;
		}
	}
	return sawPlanBlock ? planText : undefined;
}
