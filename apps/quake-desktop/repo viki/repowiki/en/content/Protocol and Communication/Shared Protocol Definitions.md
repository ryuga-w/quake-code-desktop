# Shared Protocol Definitions

<cite>
**Referenced Files in This Document**
- [protocol.ts](file://src/shared/protocol.ts)
- [index.ts](file://src/server/index.ts)
- [sse.ts](file://src/server/sse.ts)
- [runtime.ts](file://src/server/runtime.ts)
- [BrowserPanel.tsx](file://src/client/src/components/dock/BrowserPanel.tsx)
- [architecture.md](file://docs/architecture.md)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document describes the shared protocol definitions that enable type-safe communication between the client and server in the quake-web application. It focuses on the TypeScript interfaces and union types that define the message contract for session management, model configuration, file operations, extension UI requests, and plan execution. The protocol leverages a strict type system to ensure compile-time safety across the client-server boundary, while supporting forward-compatible evolution through explicit event schemas and controlled command sets.

## Project Structure
The protocol definitions live in a single shared module and are consumed by both server and client components:
- Shared protocol definitions: [protocol.ts](file://src/shared/protocol.ts)
- Server-side command handling and SSE transport: [index.ts](file://src/server/index.ts), [sse.ts](file://src/server/sse.ts)
- Server-side runtime integration for plan clarifications: [runtime.ts](file://src/server/runtime.ts)
- Client-side SSE consumption example: [BrowserPanel.tsx](file://src/client/src/components/dock/BrowserPanel.tsx)
- Transport architecture overview: [architecture.md](file://docs/architecture.md)

```mermaid
graph TB
subgraph "Shared Protocol"
P["protocol.ts<br/>Interfaces & Union Types"]
end
subgraph "Server"
S1["index.ts<br/>HTTP + Command Routing"]
S2["sse.ts<br/>SSE Hub"]
SR["runtime.ts<br/>Plan Clarifications"]
end
subgraph "Client"
C1["BrowserPanel.tsx<br/>SSE Consumer"]
end
P --> S1
P --> S2
P --> C1
S1 --> S2
S2 --> C1
S1 --> SR
```

**Diagram sources**
- [protocol.ts](file://src/shared/protocol.ts)
- [index.ts](file://src/server/index.ts)
- [sse.ts](file://src/server/sse.ts)
- [runtime.ts](file://src/server/runtime.ts)
- [BrowserPanel.tsx](file://src/client/src/components/dock/BrowserPanel.tsx)

**Section sources**
- [protocol.ts](file://src/shared/protocol.ts)
- [index.ts](file://src/server/index.ts)
- [sse.ts](file://src/server/sse.ts)
- [runtime.ts](file://src/server/runtime.ts)
- [BrowserPanel.tsx](file://src/client/src/components/dock/BrowserPanel.tsx)
- [architecture.md](file://docs/architecture.md)

## Core Components
This section documents the primary TypeScript interfaces and union types that form the shared protocol.

- JsonValue: A recursive type representing JSON-compatible values used for generic payload data.
- WebSessionSummary: Lightweight session metadata for browsing and navigation.
- WebModelSummary: Model metadata including provider, identifiers, capabilities, and configuration state.
- WebCommandInfo: Describes commands exposed by built-in, extension, prompt, or skill sources.
- WebRuntimeSettings: Runtime preferences such as default provider/model, thinking level, and UI image policies.
- WebConversationMode: Conversation modes ("execute" or "plan").
- WebPlanStep: Individual step in a plan with completion status.
- WebPlanDecision: Decision node with selectable options.
- WebPlanPhase: Lifecycle phases of plan execution.
- WebPlanClarificationOption: Option presented during plan clarification.
- WebPlanClarificationAnswer: Answer provided by the user for a clarification question.
- WebPlanQuestion: Question with optional options and recommended selection.
- WebPlanClarificationState: Complete state of a clarification dialog.
- WebPlanState: Aggregated plan state including steps, decisions, and clarification.
- WebServerConfig: Server configuration including host/port, auth, terminal policy, and limits.
- WebFileEntry: File or directory entry for file operations.
- WebSessionState: Full session state including model, thinking level, streaming flags, tool set, working directory, conversation mode, and plan state.
- WebExtensionUiRequest: Union of extension UI request variants covering selection, confirmation, input prompts, editor prefills, plan clarifications, notifications, status updates, widget placement, sidebar updates, title changes, and editor text updates.
- WebAgentEvent: Server-to-client events including ready/state updates, agent events, terminal lifecycle, error notifications, and extension UI requests.
- WebClientCommand: Client-to-server commands for prompting, aborting, session management, model configuration, runtime toggles, plan actions, slash commands, and extension UI responses.
- WebCommandResponse: Standardized command response envelope with success/failure and optional data.

**Section sources**
- [protocol.ts](file://src/shared/protocol.ts)

## Architecture Overview
The protocol uses a unidirectional server-to-client streaming channel (SSE) for events and HTTP POST endpoints for commands. The SSE transport carries both agent events and command responses, enabling real-time updates for UI rendering and state synchronization.

```mermaid
sequenceDiagram
participant Client as "Client"
participant SSE as "SSE Hub (server)"
participant Handler as "Command Handler (server)"
participant Runtime as "Runtime (server)"
Client->>SSE : "Subscribe to SSE"
SSE-->>Client : "ready/state events"
Client->>Handler : "POST /api/command (WebClientCommand)"
Handler->>Runtime : "Execute command"
Runtime-->>Handler : "Result or state change"
Handler-->>SSE : "Emit WebCommandResponse/WebAgentEvent"
SSE-->>Client : "Deliver event via SSE"
```

**Diagram sources**
- [sse.ts](file://src/server/sse.ts)
- [index.ts](file://src/server/index.ts)
- [protocol.ts](file://src/shared/protocol.ts)

**Section sources**
- [architecture.md](file://docs/architecture.md)
- [sse.ts](file://src/server/sse.ts)
- [index.ts](file://src/server/index.ts)
- [protocol.ts](file://src/shared/protocol.ts)

## Detailed Component Analysis

### Session Management Interfaces
The session-related interfaces encapsulate session metadata and runtime state for UI and operational needs.

```mermaid
classDiagram
class WebSessionSummary {
+string path
+string id
+string cwd
+string name
+string parentSessionPath
+string created
+string modified
+number messageCount
+string firstMessage
+string lastUserMessage
+string lastAssistantMessage
+object lastModel
+string lastThinkingLevel
}
class WebSessionState {
+string sessionId
+string sessionFile
+Model model
+ThinkingLevel thinkingLevel
+boolean isStreaming
+boolean isCompacting
+boolean autoCompactionEnabled
+number pendingMessageCount
+number messageCount
+string[] activeTools
+string cwd
+string conversationMode
+WebPlanState plan
}
class WebServerConfig {
+string host
+number port
+string cwd
+boolean authEnabled
+boolean terminalEnabled
+string terminalPolicyMode
+number maxFilePreviewBytes
+string[] workspaceAllowlist
+string version
}
WebSessionState --> WebPlanState : "contains"
```

**Diagram sources**
- [protocol.ts](file://src/shared/protocol.ts)

**Section sources**
- [protocol.ts](file://src/shared/protocol.ts)

### Plan Execution Data Structures
Plan execution introduces structured steps, decisions, and clarification workflows.

```mermaid
classDiagram
class WebPlanStep {
+number step
+string text
+string fullText
+boolean completed
}
class WebPlanDecision {
+string id
+string title
+string[] options
}
class WebPlanClarificationOption {
+string id
+string label
+string description
}
class WebPlanClarificationAnswer {
+string optionId
+string text
+boolean skipped
}
class WebPlanQuestion {
+string id
+string label
+string detail
+WebPlanClarificationOption[] options
+string recommendedOptionId
+boolean required
+WebPlanClarificationAnswer answer
}
class WebPlanClarificationState {
+string id
+string requestId
+string title
+string status
+WebPlanQuestion[] questions
+string activeQuestionId
+string summary
}
class WebPlanState {
+boolean enabled
+boolean executing
+string phase
+WebPlanStep[] steps
+number completed
+number activeStep
+string lastPlanText
+string planDocumentPath
+WebPlanDecision pendingDecision
+WebPlanClarificationState clarification
}
WebPlanState --> WebPlanStep : "has many"
WebPlanState --> WebPlanDecision : "may have"
WebPlanState --> WebPlanClarificationState : "may have"
WebPlanClarificationState --> WebPlanQuestion : "contains"
WebPlanQuestion --> WebPlanClarificationOption : "has many"
WebPlanClarificationState --> WebPlanClarificationAnswer : "collects"
```

**Diagram sources**
- [protocol.ts](file://src/shared/protocol.ts)

**Section sources**
- [protocol.ts](file://src/shared/protocol.ts)

### Extension UI Request Schema
Extension UI requests are modeled as a discriminated union to support various UI interaction patterns.

```mermaid
classDiagram
class WebExtensionUiRequest {
<<union>>
+"extension_ui_request" + "select"
+"extension_ui_request" + "confirm"
+"extension_ui_request" + "input"
+"extension_ui_request" + "editor"
+"extension_ui_request" + "planClarification"
+"extension_ui_request" + "notify"
+"extension_ui_request" + "setStatus"
+"extension_ui_request" + "setWidget"
+"extension_ui_request" + "setSidebar"
+"extension_ui_request" + "setTitle"
+"extension_ui_request" + "set_editor_text"
}
```

**Diagram sources**
- [protocol.ts](file://src/shared/protocol.ts)

**Section sources**
- [protocol.ts](file://src/shared/protocol.ts)

### Event and Command Type System
The protocol defines strongly typed events and commands using union types with discriminators.

```mermaid
classDiagram
class WebAgentEvent {
<<union>>
+"ready"
+"state"
+"agent_event"
+"terminal_start"
+"terminal_output"
+"terminal_end"
+"error"
+"extension_ui_request"
}
class WebClientCommand {
<<union>>
+"prompt"
+"abort"
+"new_session"
+"open_workspace"
+"switch_session"
+"fork_session"
+"set_thinking_level"
+"set_model"
+"set_default_model"
+"set_default_thinking"
+"set_auto_compaction"
+"set_block_images"
+"set_show_images"
+"set_terminal_policy"
+"set_plan_mode"
+"plan_decision"
+"plan_refine"
+"plan_clarification_answer"
+"plan_clarification_complete"
+"plan_clarification_skip"
+"slash_command"
+"extension_ui_response"
}
class WebCommandResponse {
<<union>>
+"command_response" + "success"
+"command_response" + "failure"
}
WebAgentEvent --> WebExtensionUiRequest : "includes"
WebClientCommand --> WebExtensionUiRequest : "responses"
```

**Diagram sources**
- [protocol.ts](file://src/shared/protocol.ts)

**Section sources**
- [protocol.ts](file://src/shared/protocol.ts)

### Command Handling Flow
Commands are parsed from HTTP POST bodies and routed to handlers, which may trigger state changes and emit events.

```mermaid
sequenceDiagram
participant Client as "Client"
participant Server as "HTTP Server"
participant Parser as "parseCommand"
participant Handler as "handleCommand"
participant Runtime as "Runtime"
Client->>Server : "POST /api/command"
Server->>Parser : "Read and parse body"
Parser-->>Handler : "WebClientCommand"
Handler->>Runtime : "Execute command"
alt "Session-changing commands"
Handler->>Runtime : "cancelPendingInteractions()"
end
Runtime-->>Handler : "Result"
Handler-->>Client : "WebCommandResponse"
```

**Diagram sources**
- [index.ts](file://src/server/index.ts)
- [protocol.ts](file://src/shared/protocol.ts)

**Section sources**
- [index.ts](file://src/server/index.ts)
- [protocol.ts](file://src/shared/protocol.ts)

### Plan Clarification Flow
The server coordinates plan clarifications and ensures state consistency.

```mermaid
sequenceDiagram
participant Client as "Client"
participant Runtime as "Runtime"
participant ExtUI as "Extension UI"
Client->>Runtime : "plan_clarification_answer"
Runtime->>ExtUI : "completeClarification(...)"
alt "Handled"
Runtime-->>Client : "state update"
else "Not handled"
Runtime-->>Client : "throw error"
end
Client->>Runtime : "plan_clarification_skip"
Runtime->>ExtUI : "skipClarification(...)"
alt "Handled"
Runtime-->>Client : "state update"
else "Not handled"
Runtime-->>Client : "throw error"
end
```

**Diagram sources**
- [runtime.ts](file://src/server/runtime.ts)
- [protocol.ts](file://src/shared/protocol.ts)

**Section sources**
- [runtime.ts](file://src/server/runtime.ts)
- [protocol.ts](file://src/shared/protocol.ts)

### Client-Side SSE Consumption Example
The client consumes SSE streams and handles specific event types.

```mermaid
sequenceDiagram
participant SSE as "SSE Server"
participant WS as "WebSocket/SSE Client"
participant UI as "UI Component"
SSE-->>WS : "WebAgentEvent (ready/state/terminal/error)"
WS->>UI : "Parse and dispatch"
UI-->>UI : "Render updates"
```

**Diagram sources**
- [BrowserPanel.tsx](file://src/client/src/components/dock/BrowserPanel.tsx)
- [sse.ts](file://src/server/sse.ts)

**Section sources**
- [BrowserPanel.tsx](file://src/client/src/components/dock/BrowserPanel.tsx)
- [sse.ts](file://src/server/sse.ts)

## Dependency Analysis
The protocol module is imported and used across server and client boundaries. The server depends on the protocol for type-safe command parsing and response generation, while the client consumes the protocol for event handling and UI updates.

```mermaid
graph LR
Proto["protocol.ts"] --> ServerIndex["server/index.ts"]
Proto --> SSE["server/sse.ts"]
Proto --> Client["client/BrowserPanel.tsx"]
ServerIndex --> SSE
SSE --> Client
```

**Diagram sources**
- [protocol.ts](file://src/shared/protocol.ts)
- [index.ts](file://src/server/index.ts)
- [sse.ts](file://src/server/sse.ts)
- [BrowserPanel.tsx](file://src/client/src/components/dock/BrowserPanel.tsx)

**Section sources**
- [protocol.ts](file://src/shared/protocol.ts)
- [index.ts](file://src/server/index.ts)
- [sse.ts](file://src/server/sse.ts)
- [BrowserPanel.tsx](file://src/client/src/components/dock/BrowserPanel.tsx)

## Performance Considerations
- SSE streaming avoids polling overhead and enables real-time updates for terminal output and state changes.
- Command responses are compact envelopes that minimize payload size while preserving type safety.
- Plan clarification operations are validated against current state to prevent inconsistent updates.
- Large request bodies are bounded to avoid resource exhaustion.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Unsupported command: The handler returns a standardized failure response with the command type included.
- Parse errors: Body parsing failures lead to explicit error responses.
- Terminal policy changes: Updating terminal policy triggers reinitialization and reflects new state in the response payload.
- Plan clarification invalid: Attempting to finalize or skip a clarification that is no longer valid throws an error indicating state was refreshed.

**Section sources**
- [index.ts](file://src/server/index.ts)
- [protocol.ts](file://src/shared/protocol.ts)

## Conclusion
The shared protocol establishes a robust, type-safe contract for client-server communication. Through discriminated unions, standardized envelopes, and explicit event schemas, it ensures compile-time safety while enabling flexible evolution. The SSE-based transport and HTTP command endpoints provide a scalable foundation for real-time updates and interactive features such as plan execution and extension UI workflows.
