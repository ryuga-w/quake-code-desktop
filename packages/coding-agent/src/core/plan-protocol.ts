export type CollaborationModeKind = "default" | "plan";

export type PlanStepStatus = "pending" | "in_progress" | "completed";

export interface PlanStep {
	step: string;
	status: PlanStepStatus;
}

export interface UpdatePlanArgs {
	explanation?: string;
	plan: PlanStep[];
}

export interface RequestUserInputOption {
	label: string;
	description: string;
}

export interface RequestUserInputQuestion {
	id: string;
	header: string;
	question: string;
	options: RequestUserInputOption[];
}

export interface RequestUserInputArgs {
	questions: RequestUserInputQuestion[];
	autoResolutionMs?: number;
}

export interface RequestUserInputAnswer {
	answers: string[];
}

export interface RequestUserInputResponse {
	answers: Record<string, RequestUserInputAnswer>;
}

export type PlanSessionEvent =
	| {
			type: "collaboration_mode_changed";
			mode: CollaborationModeKind;
	  }
	| {
			type: "turn/plan/updated";
			threadId: string;
			turnId: string;
			explanation?: string;
			plan: PlanStep[];
	  }
	| {
			type: "item/started";
			threadId: string;
			turnId: string;
			item: { type: "plan"; id: string; text: string };
	  }
	| {
			type: "item/plan/delta";
			threadId: string;
			turnId: string;
			itemId: string;
			delta: string;
	  }
	| {
			type: "item/completed";
			threadId: string;
			turnId: string;
			item: { type: "plan"; id: string; text: string };
	  }
	| {
			type: "plan/cleared";
			threadId: string;
			turnId: string;
	  };
