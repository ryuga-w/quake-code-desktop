import type { Component } from "@mrquake/quakecode-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.js";

/**
 * Built-in footer intentionally renders nothing.
 *
 * Keep the component and its public methods so extensions and session switching
 * remain API-compatible without reserving terminal rows for status metadata.
 */
export class FooterComponent implements Component {
  autoCompactEnabled = true;

  constructor(
    private session: AgentSession,
    _footerData: ReadonlyFooterDataProvider,
  ) {}

  setSession(session: AgentSession): void {
    this.session = session;
  }

  setAutoCompactEnabled(enabled: boolean): void {
    this.autoCompactEnabled = enabled;
  }

  invalidate(): void {
    // No rendered state to invalidate.
  }

  dispose(): void {
    // No owned resources.
  }

  render(_width: number): string[] {
    return [];
  }
}
