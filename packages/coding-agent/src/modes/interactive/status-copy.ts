export const statusCopy = {
	web: {
		researchingExternalSources: "Researching external sources",
		externalReferencesCollected: "External references collected",
		inspectingPage: "Inspecting page",
		pageReadyForInspection: "Page ready for inspection",
		checkingPageEvidence: "Checking page evidence",
		pageEvidenceCollected: "Page evidence collected",
	},
	browser: {
		browser_navigate: {
			pending: "Inspecting page",
			complete: "Page ready for inspection",
		},
		browser_snapshot: {
			pending: "Capturing page state",
			complete: "Page state captured",
		},
		browser_click: {
			pending: "Applying interaction",
			complete: "Interaction applied",
		},
		browser_type: {
			pending: "Entering input",
			complete: "Input applied",
		},
		browser_fill_form: {
			pending: "Populating form",
			complete: "Form populated",
		},
		browser_select_option: {
			pending: "Selecting option",
			complete: "Option selected",
		},
		browser_hover: {
			pending: "Inspecting hover state",
			complete: "Hover state captured",
		},
		browser_press_key: {
			pending: "Sending key sequence",
			complete: "Key sequence applied",
		},
		browser_drag: {
			pending: "Applying drag interaction",
			complete: "Drag interaction applied",
		},
		browser_wait_for: {
			pending: "Waiting for target condition",
			complete: "Target condition confirmed",
		},
		browser_take_screenshot: {
			pending: "Capturing visual evidence",
			complete: "Visual evidence captured",
		},
		browser_console_messages: {
			pending: "Reviewing console activity",
			complete: "Console activity collected",
		},
		browser_network_requests: {
			pending: "Reviewing network activity",
			complete: "Network activity collected",
		},
		browser_tabs: {
			pending: "Reviewing browser tabs",
			complete: "Browser tabs collected",
		},
		browser_close: {
			pending: "Closing browser tab",
			complete: "Browser tab closed",
		},
		browser_run_code: {
			pending: "Executing browser code",
			complete: "Browser code executed",
		},
		browser_evaluate: {
			pending: "Evaluating browser expression",
			complete: "Browser expression evaluated",
		},
		browser_file_upload: {
			pending: "Attaching files to page",
			complete: "Files attached to page",
		},
		browser_handle_dialog: {
			pending: "Handling dialog",
			complete: "Dialog handled",
		},
		browser_resize: {
			pending: "Updating viewport",
			complete: "Viewport updated",
		},
		browser_navigate_back: {
			pending: "Returning to previous page",
			complete: "Returned to previous page",
		},
	},
	files: {
		reading: "Reading",
		editing: "Editing",
		writing: "Writing",
		readingTargetedLineRange: "Reading a targeted line range",
		pullingFileContentsIntoContext: "Pulling file contents into context",
		preparingReviewDiff: "Preparing review diff...",
		reviewPreview: "Review preview",
		preparingTargetedSourceChange: "Preparing a targeted source change",
		creatingOrReplacingFileContent: "Creating or replacing file content",
		appliedEditSuccessfully: "Applied edit successfully",
		wroteFileSuccessfully: "Wrote file successfully",
		editFailed: "Edit failed",
		writeFailed: "Write failed",
		updatedFile: "Updated file",
		completedWithNoOutput: "Completed with no output",
		readFailed: "Read failed",
	},
	bash: {
		inspectWorkspaceStructure: "Inspecting workspace structure",
		scanningFoldersAndTopLevelProjectLayout: "Scanning folders and top-level project layout",
		scanningFoldersUnder: (path: string) => `Scanning folders under ${path}`,
		scanningWorkspaceFiles: "Scanning workspace files",
		scanningFilesUnder: (path: string) => `Scanning files under ${path}`,
		listingCandidateFilesBeforeNarrowingScope: "Listing candidate files before narrowing scope",
		searchingWorkspace: "Searching workspace",
		searchingFor: (query: string) => `Searching for "${query}"`,
		lookingThrough: (path: string) => `Looking through ${path}`,
		lookingForMatchingContent: "Looking for matching content",
		readingFileContents: "Reading file contents",
		pullingInSourceDetailsForTheNextStep: "Pulling in source details for the next step",
		checkingGitState: "Checking git state",
		reviewingRepositoryHistoryOrChanges: "Reviewing repository history or changes",
		runningBuild: "Running build",
		validatingProjectCompilesCleanly: "Validating the project compiles cleanly",
		runningTests: "Running tests",
		checkingBehaviorAgainstTheTestSuite: "Checking behavior against the test suite",
		runningScript: "Running script",
		executingHelperCommand: "Executing a helper command",
		executingPath: (path: string) => `Executing ${path}`,
		updatingFilesystem: "Updating filesystem",
		applyingFileOrDirectoryChanges: "Applying file or directory changes",
		runningShellCommand: "Running shell command",
		commandCancelledBeforeCompletion: "Command was cancelled before completion",
		commandFailed: "Command failed",
		commandExitedWithCode: (code: number) => `Command exited with code ${code}`,
		buildCompletedSuccessfully: "Build completed successfully",
		buildFailedWithExit: (code: number) => `Build failed with exit ${code}`,
		testsCompletedSuccessfully: "Tests completed successfully",
		testsFailedWithExit: (code: number) => `Tests failed with exit ${code}`,
		verificationCommandFinished: (command?: string) =>
			`Verification command finished${command ? ` · ${command}` : ""}`,
		searchCommandCompleted: (command?: string) => `Search command completed${command ? ` · ${command}` : ""}`,
		shellCommandCompleted: (command?: string) => `Shell command completed${command ? ` · ${command}` : ""}`,
	},
	generic: {
		executionQueued: "Execution queued",
		awaitingFirstOutput: "Awaiting first output",
		receivingPartialEvidence: "Receiving partial evidence",
		streamingEvidence: (lineCount: number) => `Streaming ${lineCount} line${lineCount === 1 ? "" : "s"} of evidence`,
		operationFailedWithoutTextOutput: "Operation failed without text output",
		completedWithoutTextOutput: "Completed without text output",
		operationReturnedBeforeFailing: (lineCount: number) =>
			`Operation returned ${lineCount} line${lineCount === 1 ? "" : "s"} before failing`,
		collectedOutput: (lineCount: number) => `Collected ${lineCount} line${lineCount === 1 ? "" : "s"} of output`,
		intent: {
			inspectUrl: (url: string) => `Inspecting ${url}`,
			checkTool: (toolName: string) => `Checking ${toolName}`,
			executeTool: (toolName: string) => `Executing ${toolName}`,
			inspectTool: (toolName: string) => `Inspecting ${toolName}`,
			coordinateTool: (toolName: string) => `Coordinating ${toolName}`,
			focus: (query: string) => `Focus: ${query}`,
		},
	},
} as const;

const GROK_AUTH_PROVIDERS = new Set(["grok-cli", "grok", "xai"]);

export function formatProviderReauthHint(provider: string): string {
	if (GROK_AUTH_PROVIDERS.has(provider)) {
		return "Run `grok login` to re-authenticate, then check with /grok.";
	}
	return `Run '/login ${provider}' to re-authenticate.`;
}

export function formatProviderApiKeyHint(provider: string): string {
	if (GROK_AUTH_PROVIDERS.has(provider)) {
		return "Run `grok login`, set GROK_AUTH_TOKEN, or set XAI_API_KEY. Use /grok for status.";
	}
	const envName = `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
	return `Set ${envName} or run '/login ${provider}'.`;
}

// Operator-grade error taxonomy (calm, exact, accountable)
export const operatorCopy = {
	errors: {
		authExpired: (provider: string) =>
			`Authentication expired for ${provider}. ${formatProviderReauthHint(provider)}`,
		authFailed: (provider: string) =>
			`Authentication failed for ${provider}. Credentials may be invalid or network unavailable.`,
		noApiKey: (provider: string) => `No API key configured for ${provider}. ${formatProviderApiKeyHint(provider)}`,
		invalidCredentials: "Credentials invalid. Check your API key or re-authenticate.",
		rateLimited: "Rate limit reached. Retrying with exponential backoff.",
		overloaded: "Provider overloaded. Queued for retry.",
		networkError: "Network error. Check connectivity and retry.",
		serviceUnavailable: (provider: string) =>
			`Service unavailable: ${provider}. Provider may be experiencing issues.`,
		contextOverflow: "Context window exceeded. Consider compacting or starting a new session.",
		invalidRequest: "Invalid request parameters. Check model compatibility.",
		sessionCorrupted: "Session data corrupted. Some history may be unavailable.",
		compactionFailed: "Context compaction failed. Retry or start new session.",
	},

	retry: {
		attempt: (attempt: number, max: number, delayMs: number) =>
			`Retry ${attempt}/${max} in ${(delayMs / 1000).toFixed(1)}s`,
		exhausted: "Retry attempts exhausted. Manual intervention required.",
		succeeded: (attempt: number) => `Succeeded after ${attempt} attempts`,
	},

	session: {
		resumingInto: (posture: string) => `Resumed into ${posture} session`,
		verificationPending: "Verification pending. Changes await validation.",
		reviewPending: "Review pending. High-impact changes detected.",
		interruptionRecovered: "Recovered from interrupted operation.",
		contextCompacted: "Context compacted. Recent summary available.",
		deepSession: (depth: number) => `Deep context (${depth} messages). Consider compaction.`,
	},

	evidence: {
		filesTouched: (count: number) => `${count} file${count === 1 ? "" : "s"} touched`,
		sensitiveSurface: "Sensitive configuration surface touched",
		dependencySurface: "Dependency configuration modified",
		authSurface: "Authentication configuration modified",
		verificationRecommended: "Verification recommended",
		workspaceMutated: "Workspace state changed",
		readOnlyInspection: "Read-only inspection complete",
	},

	provider: {
		switching: (from: string, to: string) => `Switching from ${from} to ${to}`,
		fallback: (unavailable: string, fallback: string) => `${unavailable} unavailable. Using ${fallback}.`,
		configured: (provider: string) => `${provider} configured`,
		disconnected: (provider: string) => `${provider} disconnected`,
	},
} as const;
