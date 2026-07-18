# Communication Patterns

<cite>
**Referenced Files in This Document**
- [sse.ts](file://src/server/sse.ts)
- [protocol.ts](file://src/shared/protocol.ts)
- [index.ts](file://src/server/index.ts)
- [api.ts](file://src/client/src/lib/api.ts)
- [main.tsx](file://src/client/src/main.tsx)
- [terminal-pty.ts](file://src/server/terminal-pty.ts)
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
This document describes the communication patterns used by the system, focusing on:
- Server-Sent Events (SSE) for real-time server-to-browser updates
- HTTP API design for command processing
- WebSocket considerations for future enhancements
It explains the event streaming architecture, message serialization/deserialization, error handling in distributed scenarios, and how the system maintains reliability across network failures. It also documents protocol definitions, event schemas, and client-side event handling patterns.

## Project Structure
The communication layer spans three primary areas:
- Server-side SSE hub and HTTP endpoints
- Shared protocol definitions for typed messages
- Client-side SSE consumption and HTTP command dispatch

```mermaid
graph TB
subgraph "Server"
SSE["SseHub<br/>src/server/sse.ts"]
HTTP["HTTP Server<br/>src/server/index.ts"]
WS["Terminal WebSocket<br/>src/server/terminal-pty.ts"]
end
subgraph "Shared"
Proto["Protocol Types<br/>src/shared/protocol.ts"]
end
subgraph "Client"
SSEClient["EventSource Consumer<br/>src/client/src/main.tsx"]
APIClient["HTTP Client Utilities<br/>src/client/src/lib/api.ts"]
end
Proto --> SSE
Proto --> HTTP
Proto --> SSEClient
Proto --> APIClient
SSEClient --> SSE
APIClient --> HTTP
HTTP --> SSE
HTTP --> WS
```

**Diagram sources**
- [sse.ts:1-32](file://src/server/sse.ts#L1-L32)
- [protocol.ts:1-198](file://src/shared/protocol.ts#L1-L198)
- [index.ts:1-679](file://src/server/index.ts#L1-L679)
- [api.ts:1-59](file://src/client/src/lib/api.ts#L1-L59)
- [main.tsx:570-588](file://src/client/src/main.tsx#L570-L588)
- [terminal-pty.ts:1-95](file://src/server/terminal-pty.ts#L1-L95)

**Section sources**
- [architecture.md:42-45](file://docs/architecture.md#L42-L45)
- [sse.ts:1-32](file://src/server/sse.ts#L1-L32)
- [protocol.ts:1-198](file://src/shared/protocol.ts#L1-L198)
- [index.ts:1-679](file://src/server/index.ts#L1-L679)
- [api.ts:1-59](file://src/client/src/lib/api.ts#L1-L59)
- [main.tsx:570-588](file://src/client/src/main.tsx#L570-L588)
- [terminal-pty.ts:1-95](file://src/server/terminal-pty.ts#L1-L95)

## Core Components
- SSE Hub: Manages SSE connections and broadcasts typed events to all connected clients.
- Protocol Types: Define the shape of server events, client commands, and command responses.
- HTTP Server: Routes requests to handlers, validates auth, and executes commands.
- Client SSE Consumer: Subscribes to SSE, parses incoming events, and reconciles UI state.
- HTTP Client Utilities: Provides typed helpers for GET/POST/PATCH/DELETE with token support.
- Terminal WebSocket: Real-time interactive terminal via WebSocket with PTY bridging.

**Section sources**
- [sse.ts:6-31](file://src/server/sse.ts#L6-L31)
- [protocol.ts:161-198](file://src/shared/protocol.ts#L161-L198)
- [index.ts:401-662](file://src/server/index.ts#L401-L662)
- [api.ts:9-59](file://src/client/src/lib/api.ts#L9-L59)
- [main.tsx:570-588](file://src/client/src/main.tsx#L570-L588)
- [terminal-pty.ts:24-95](file://src/server/terminal-pty.ts#L24-L95)

## Architecture Overview
The system uses a unidirectional SSE channel for server-to-browser updates and HTTP POST endpoints for command submission. Terminal output streaming leverages SSE, while interactive terminal sessions use WebSocket. Future phases may introduce WebSocket for bidirectional needs.

```mermaid
sequenceDiagram
participant Browser as "Browser"
participant SSEClient as "EventSource (main.tsx)"
participant HTTP as "HTTP Server (index.ts)"
participant SSE as "SseHub (sse.ts)"
participant Runtime as "Runtime Controller"
Browser->>SSEClient : "Connect to /api/events"
SSEClient->>HTTP : "GET /api/events"
HTTP->>SSE : "hub.add(res)"
SSE-->>Browser : "SSE connection established"
Runtime->>SSE : "hub.send(WebAgentEvent)"
SSE-->>Browser : "data : {event JSON}\n\n"
Browser->>HTTP : "POST /api/command {WebClientCommand}"
HTTP->>Runtime : "handleCommand()"
Runtime-->>HTTP : "WebCommandResponse"
HTTP-->>Browser : "{command_response JSON}"
Note over Browser,SSE : "Events are JSON-encoded per SSE spec"
```

**Diagram sources**
- [main.tsx:570-588](file://src/client/src/main.tsx#L570-L588)
- [index.ts:408-412](file://src/server/index.ts#L408-L412)
- [sse.ts:9-26](file://src/server/sse.ts#L9-L26)
- [protocol.ts:161-198](file://src/shared/protocol.ts#L161-L198)

## Detailed Component Analysis

### Server-Sent Events Implementation
- SSE Hub manages a set of active connections and writes newline-delimited events with UTF-8 encoding.
- Each event is a JSON-serialized payload of either a server event or a command response.
- Clients receive a heartbeat-like initial message upon connection establishment.

```mermaid
classDiagram
class SseHub {
-clients : Set<ServerResponse>
+add(res : ServerResponse) void
+send(payload : SsePayload) void
+size : number
}
class Protocol {
<<types>>
+WebAgentEvent
+WebCommandResponse
}
SseHub --> Protocol : "serializes payloads"
```

**Diagram sources**
- [sse.ts:6-31](file://src/server/sse.ts#L6-L31)
- [protocol.ts:161-198](file://src/shared/protocol.ts#L161-L198)

**Section sources**
- [sse.ts:9-26](file://src/server/sse.ts#L9-L26)

### HTTP API Design for Command Processing
- Commands are submitted via POST /api/command with a JSON body matching WebClientCommand.
- The server parses the request body, delegates to runtime handlers, and returns WebCommandResponse.
- Authentication is enforced for protected routes; unauthorized requests are rejected early.
- The server centralizes endpoint routing and error-to-HTTP conversion.

```mermaid
sequenceDiagram
participant Client as "Client"
participant API as "HTTP Server"
participant Handler as "handleCommand"
participant Runtime as "Runtime Controller"
Client->>API : "POST /api/command {WebClientCommand}"
API->>Handler : "parseCommand() + dispatch"
Handler->>Runtime : "apply operation"
Runtime-->>Handler : "result or error"
Handler-->>API : "ok()/fail()"
API-->>Client : "{command_response JSON}"
```

**Diagram sources**
- [index.ts:626-630](file://src/server/index.ts#L626-L630)
- [index.ts:242-374](file://src/server/index.ts#L242-L374)
- [protocol.ts:171-193](file://src/shared/protocol.ts#L171-L193)

**Section sources**
- [index.ts:626-630](file://src/server/index.ts#L626-L630)
- [index.ts:242-245](file://src/server/index.ts#L242-L245)
- [index.ts:247-253](file://src/server/index.ts#L247-L253)

### WebSocket Considerations for Future Enhancements
- Interactive terminal sessions use WebSocket (/api/terminal) with PTY bridging.
- WebSocket is reserved for bidirectional needs such as terminal cancellation, richer extension dialogs, or multi-session interactivity.
- Current SSE covers most real-time needs; WebSocket remains deferred until Phase 2.

```mermaid
sequenceDiagram
participant Client as "Client"
participant WS as "WebSocket Server"
participant PTY as "node-pty"
Client->>WS : "Upgrade /api/terminal"
WS->>PTY : "spawn shell with cols/rows"
PTY-->>WS : "output data"
WS-->>Client : "{t : 'o', d : ...}"
Client->>WS : "{t : 'i', d : keys} or {t : 'r', c,w}"
WS->>PTY : "write/resize"
PTY-->>WS : "exit code"
WS-->>Client : "{t : 'x', code}"
```

**Diagram sources**
- [terminal-pty.ts:24-95](file://src/server/terminal-pty.ts#L24-L95)

**Section sources**
- [terminal-pty.ts:24-95](file://src/server/terminal-pty.ts#L24-L95)
- [architecture.md:42-45](file://docs/architecture.md#L42-L45)

### Event Streaming Architecture and Message Serialization
- Server emits WebAgentEvent messages (ready, state updates, agent events, terminal lifecycle, errors, extension UI requests).
- Client consumes SSE via EventSource and parses each message into a structured event.
- Serialization uses JSON.stringify for SSE data fields; clients must guard against malformed payloads.

```mermaid
flowchart TD
Start(["Server Event"]) --> Serialize["JSON.stringify(payload)"]
Serialize --> SSEWrite["Write 'data: ...\\n\\n'"]
SSEWrite --> Broadcast["Send to all clients"]
Broadcast --> Receive["Client receives message"]
Receive --> Parse["Parse JSON"]
Parse --> Dispatch["Dispatch to handler"]
Dispatch --> UIUpdate["Update UI state"]
```

**Diagram sources**
- [sse.ts:21-26](file://src/server/sse.ts#L21-L26)
- [protocol.ts:161-169](file://src/shared/protocol.ts#L161-L169)
- [main.tsx:577-578](file://src/client/src/main.tsx#L577-L578)

**Section sources**
- [sse.ts:21-26](file://src/server/sse.ts#L21-L26)
- [protocol.ts:161-169](file://src/shared/protocol.ts#L161-L169)
- [main.tsx:577-578](file://src/client/src/main.tsx#L577-L578)

### Client-Side Event Handling Patterns
- Establishes SSE connection on mount, listens for open/message/error, and cleans up on unmount.
- On error, triggers a reconciliation refresh if streaming or UI state suggests ongoing activity.
- Uses a tokenized URL for SSE when available.

```mermaid
sequenceDiagram
participant Comp as "React Component"
participant ES as "EventSource"
participant Store as "App Store"
Comp->>ES : "new EventSource(eventsUrl())"
ES-->>Comp : "onopen"
Comp->>Store : "refreshSessionState()"
ES-->>Comp : "onmessage(data)"
Comp->>Comp : "handleServerMessage(JSON.parse(data))"
ES-->>Comp : "onerror"
alt "streaming or dangling UI state"
Comp->>Store : "refreshSessionState()"
end
Comp->>ES : "cleanup on unmount"
```

**Diagram sources**
- [main.tsx:570-588](file://src/client/src/main.tsx#L570-L588)

**Section sources**
- [main.tsx:570-588](file://src/client/src/main.tsx#L570-L588)
- [api.ts:48-50](file://src/client/src/lib/api.ts#L48-L50)

### Protocol Definitions and Event Schemas
- WebAgentEvent: Covers session readiness, state updates, agent events, terminal lifecycle, error reporting, and extension UI requests.
- WebClientCommand: Covers prompting, aborting, session management, settings toggles, plan-related actions, slash commands, and extension UI responses.
- WebCommandResponse: Standardized success/failure responses for commands.

```mermaid
classDiagram
class WebAgentEvent {
+type : "ready"|"state"|"agent_event"|"terminal_start"|"terminal_output"|"terminal_end"|"error"|WebExtensionUiRequest
}
class WebClientCommand {
+type : "prompt"|"abort"|...extension UI|...plan actions
}
class WebCommandResponse {
+type : "command_response"
+success : boolean
+data? : any
+error? : string
}
class WebExtensionUiRequest {
+type : "extension_ui_request"
+id : string
+method : string
+options...
}
WebAgentEvent --> WebExtensionUiRequest : "union member"
```

**Diagram sources**
- [protocol.ts:161-198](file://src/shared/protocol.ts#L161-L198)

**Section sources**
- [protocol.ts:161-198](file://src/shared/protocol.ts#L161-L198)

## Dependency Analysis
- Server depends on shared protocol types for typed SSE payloads and command handling.
- Client consumes protocol types for event parsing and command construction.
- HTTP server orchestrates SSE hub and WebSocket attachment for terminal sessions.
- Client utilities encapsulate authentication tokens and HTTP semantics.

```mermaid
graph LR
Proto["protocol.ts"] --> SSE["sse.ts"]
Proto --> HTTP["index.ts"]
Proto --> API["api.ts"]
Proto --> MAIN["main.tsx"]
HTTP --> SSE
HTTP --> WS["terminal-pty.ts"]
MAIN --> API
```

**Diagram sources**
- [protocol.ts:1-198](file://src/shared/protocol.ts#L1-L198)
- [sse.ts:1-32](file://src/server/sse.ts#L1-L32)
- [index.ts:1-679](file://src/server/index.ts#L1-L679)
- [api.ts:1-59](file://src/client/src/lib/api.ts#L1-L59)
- [main.tsx:570-588](file://src/client/src/main.tsx#L570-L588)
- [terminal-pty.ts:1-95](file://src/server/terminal-pty.ts#L1-L95)

**Section sources**
- [index.ts:1-679](file://src/server/index.ts#L1-L679)
- [terminal-pty.ts:1-95](file://src/server/terminal-pty.ts#L1-L95)

## Performance Considerations
- SSE buffering: The server disables buffering to ensure low-latency delivery.
- Keep-alive headers maintain persistent connections; clients should reconnect on failure.
- Large payloads: Prefer incremental updates (e.g., terminal_output) to avoid oversized single events.
- Concurrency: Command handling is serialized via locks to prevent race conditions on shared resources.

## Troubleshooting Guide
- SSE connection drops:
  - Client automatically attempts reconciliation when streaming or dangling UI state is detected.
  - Verify server logs for connection close events and ensure SSE endpoint is reachable.
- Authentication failures:
  - Protected endpoints reject unauthorized requests; confirm token presence and validity.
- Command errors:
  - Server returns standardized WebCommandResponse with error details; inspect response payload for diagnostics.
- Terminal WebSocket:
  - Ensure proper shell availability and permissions; PTY spawn failures are reported via WebSocket close with error text.

**Section sources**
- [main.tsx:579-582](file://src/client/src/main.tsx#L579-L582)
- [index.ts:404-407](file://src/server/index.ts#L404-L407)
- [index.ts:251-253](file://src/server/index.ts#L251-L253)
- [terminal-pty.ts:61-66](file://src/server/terminal-pty.ts#L61-L66)

## Conclusion
The system employs a robust, layered communication strategy:
- SSE delivers real-time updates with minimal overhead and clear error boundaries.
- HTTP POST endpoints provide a reliable command surface with centralized validation and error handling.
- WebSocket is reserved for specialized bidirectional needs, deferring complexity until Phase 2.
Together, these patterns enable a responsive, resilient client-server interaction model suitable for development workflows and interactive terminals.
