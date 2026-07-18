/** Stage-1 (Phase 1) artifact contract — Codex Stage1Output-shaped FS records. */

export interface Stage1Record {
	/** Stable thread/session id */
	thread_id: string;
	/** Absolute or logical path to source rollout/session file */
	rollout_path: string;
	cwd: string;
	/** ISO timestamp of source activity */
	source_updated_at: string;
	/** Detailed markdown raw memory */
	raw_memory: string;
	/** Compact routing summary */
	rollout_summary: string;
	/** Optional filename stem for rollout_summaries/{slug}.md */
	rollout_slug?: string | null;
	/** succeeded | succeeded_no_output | failed */
	outcome: "succeeded" | "succeeded_no_output" | "failed";
	/** Whether Phase 2 already selected this snapshot */
	selected_for_phase2?: boolean;
	generated_at: string;
}
