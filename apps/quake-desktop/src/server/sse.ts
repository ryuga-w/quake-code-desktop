import type { ServerResponse } from "node:http";
import type { WebAgentEvent, WebCommandResponse } from "../shared/protocol.js";

export type SsePayload = WebAgentEvent | WebCommandResponse;

export class SseHub {
  private clients = new Set<ServerResponse>();

  add(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  send(payload: SsePayload): void {
    const body = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      client.write(body);
    }
  }

  get size(): number {
    return this.clients.size;
  }
}
