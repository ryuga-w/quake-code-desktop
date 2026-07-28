import type { CustomMessage } from "./messages.js";

export interface SessionQueueSnapshot {
	steering: string[];
	followUp: string[];
}

/**
 * Keeps all user-visible queued session state in one place.
 * This is intentionally separate from the underlying Agent queues so UI-facing
 * session semantics can evolve without leaking raw agent internals everywhere.
 */
export class SessionQueueState {
	private steeringMessages: string[] = [];
	private followUpMessages: string[] = [];
	private pendingNextTurnMessages: CustomMessage[] = [];

	addSteering(text: string): void {
		this.steeringMessages.push(text);
	}

	addFollowUp(text: string): void {
		this.followUpMessages.push(text);
	}

	queueNextTurn(message: CustomMessage): void {
		this.pendingNextTurnMessages.push(message);
	}

	drainNextTurnMessages(): CustomMessage[] {
		const drained = [...this.pendingNextTurnMessages];
		this.pendingNextTurnMessages = [];
		return drained;
	}

	peekNextTurnMessages(): readonly CustomMessage[] {
		return this.pendingNextTurnMessages;
	}

	removeDeliveredUserText(text: string): boolean {
		const steeringIndex = this.steeringMessages.indexOf(text);
		if (steeringIndex !== -1) {
			this.steeringMessages.splice(steeringIndex, 1);
			return true;
		}

		const followUpIndex = this.followUpMessages.indexOf(text);
		if (followUpIndex !== -1) {
			this.followUpMessages.splice(followUpIndex, 1);
			return true;
		}

		return false;
	}

	clear(): SessionQueueSnapshot {
		const snapshot = this.snapshot();
		this.steeringMessages = [];
		this.followUpMessages = [];
		return snapshot;
	}

	snapshot(): SessionQueueSnapshot {
		return {
			steering: [...this.steeringMessages],
			followUp: [...this.followUpMessages],
		};
	}

	get pendingMessageCount(): number {
		return this.steeringMessages.length + this.followUpMessages.length;
	}

	getSteeringMessages(): readonly string[] {
		return this.steeringMessages;
	}

	getFollowUpMessages(): readonly string[] {
		return this.followUpMessages;
	}
}
