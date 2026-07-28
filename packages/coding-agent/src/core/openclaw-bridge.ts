/**
 * OpenClawBridge - compatibility layer for OpenClaw-style action routing.
 *
 * NOTE:
 * The Quake OS tools already have a native execution path in os-control.ts.
 * Until OpenClaw action routing is fully implemented, this bridge must fail closed
 * so AgentSession can safely fall back to the original tool implementation.
 */

export class OpenClawBridge {
	async performAction(_actionName: string, _params: any): Promise<any> {
		throw new Error("OpenClaw bridge routing is not implemented yet; falling back to native OS tool execution.");
	}
}
