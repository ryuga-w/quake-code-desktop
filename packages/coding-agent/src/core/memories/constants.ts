/** Codex-compatible memories constants (codex-rs/ext/memories). */

export const MEMORY_TOOLS_NAMESPACE = "memories";

export const ADD_AD_HOC_NOTE_TOOL_NAME = "add_ad_hoc_note";
export const LIST_TOOL_NAME = "list";
export const READ_TOOL_NAME = "read";
export const SEARCH_TOOL_NAME = "search";

/** Flat tool names registered in Quake (namespace_tool). */
export const MEMORIES_LIST = "memories_list";
export const MEMORIES_READ = "memories_read";
export const MEMORIES_SEARCH = "memories_search";
export const MEMORIES_ADD_AD_HOC_NOTE = "memories_add_ad_hoc_note";

export const DEFAULT_LIST_MAX_RESULTS = 2_000;
export const MAX_LIST_RESULTS = 2_000;
export const DEFAULT_SEARCH_MAX_RESULTS = 200;
export const MAX_SEARCH_RESULTS = 200;
export const DEFAULT_READ_MAX_TOKENS = 20_000;
export const MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT = 2_500;

export const AD_HOC_NOTES_REL = ["extensions", "ad_hoc", "notes"] as const;
export const AD_HOC_NOTE_FILENAME_MAX = 128;
export const TIMESTAMP_PREFIX_LEN = "YYYY-MM-DDTHH-MM-SS-".length;

/** Root under home: mirrors ~/.codex/memories */
export const MEMORIES_HOME_DIRNAME = "memories";
