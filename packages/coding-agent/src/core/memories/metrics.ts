/**
 * Lightweight counters standing in for Codex OTel metrics (read/write/tools).
 * In-process only; hosts can snapshot via getMemoryMetrics().
 */

export type MemoryMetricName =
	| "tool_list"
	| "tool_read"
	| "tool_search"
	| "tool_add_ad_hoc"
	| "tool_error"
	| "phase1_run"
	| "phase1_succeeded"
	| "phase1_no_output"
	| "phase1_failed"
	| "phase2_run"
	| "phase2_changed"
	| "phase2_noop"
	| "startup_run"
	| "startup_skipped_rate_limit"
	| "startup_skipped_feature"
	| "citation_parse"
	| "citation_attach"
	| "read_usage_record";

const counters = new Map<MemoryMetricName, number>();

export function incMemoryMetric(name: MemoryMetricName, by = 1): void {
	counters.set(name, (counters.get(name) || 0) + by);
}

export function getMemoryMetrics(): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [k, v] of counters) out[k] = v;
	return out;
}

export function resetMemoryMetrics(): void {
	counters.clear();
}

export function recordToolCall(
	tool: "list" | "read" | "search" | "add_ad_hoc",
	ok: boolean,
): void {
	if (!ok) {
		incMemoryMetric("tool_error");
		return;
	}
	if (tool === "list") incMemoryMetric("tool_list");
	else if (tool === "read") incMemoryMetric("tool_read");
	else if (tool === "search") incMemoryMetric("tool_search");
	else incMemoryMetric("tool_add_ad_hoc");
}
