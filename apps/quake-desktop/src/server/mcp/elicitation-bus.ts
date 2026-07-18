/**
 * Bridges MCP server `elicitation/create` requests to the desktop UI and back.
 * Pending requests pause the MCP client handler until the user responds.
 */

export type McpElicitationAction = "accept" | "decline" | "cancel";

export type McpElicitationMode = "form" | "url" | string;

export interface McpElicitationField {
  name: string;
  type: "string" | "boolean" | "number" | "integer" | "enum" | "array";
  title?: string;
  description?: string;
  required?: boolean;
  enum?: string[];
  enumNames?: string[];
  default?: string | number | boolean | string[];
  format?: string;
  secret?: boolean;
}

export interface McpElicitationRequestUi {
  id: string;
  serverId: string;
  serverName: string;
  mode: McpElicitationMode;
  message: string;
  /** form fields derived from requestedSchema */
  fields: McpElicitationField[];
  /** url mode */
  url?: string;
  elicitationId?: string;
  createdAt: number;
}

export type McpElicitationResult = {
  action: McpElicitationAction;
  content?: Record<string, string | number | boolean | string[]>;
};

type Pending = {
  request: McpElicitationRequestUi;
  resolve: (result: McpElicitationResult) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export type McpElicitationEmitter = {
  emit: (request: McpElicitationRequestUi) => void;
};

let seq = 0;
const pending = new Map<string, Pending>();
let emitter: McpElicitationEmitter | undefined;

export function setMcpElicitationEmitter(next: McpElicitationEmitter | undefined): void {
  emitter = next;
}

export function listPendingMcpElicitations(): McpElicitationRequestUi[] {
  return [...pending.values()].map((p) => p.request);
}

/** Test/reset helper — cancel all pending with cancel action */
export function clearPendingMcpElicitations(): void {
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve({ action: "cancel" });
  }
}

export function respondMcpElicitation(
  id: string,
  result: McpElicitationResult,
): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  if (entry.timer) clearTimeout(entry.timer);
  entry.resolve(result);
  return true;
}

export async function requestMcpElicitation(input: {
  serverId: string;
  serverName: string;
  params: any;
  timeoutMs?: number;
}): Promise<McpElicitationResult> {
  const id = `mcp_elicit_${Date.now()}_${++seq}`;
  const mode = String(input.params?.mode || "form");
  const request: McpElicitationRequestUi = {
    id,
    serverId: input.serverId,
    serverName: input.serverName,
    mode,
    message: String(input.params?.message || "MCP sunucusu bilgi istiyor"),
    fields: mode === "url" ? [] : parseRequestedSchema(input.params?.requestedSchema),
    url: typeof input.params?.url === "string" ? input.params.url : undefined,
    elicitationId:
      typeof input.params?.elicitationId === "string" ? input.params.elicitationId : undefined,
    createdAt: Date.now(),
  };

  return new Promise<McpElicitationResult>((resolve) => {
    // Allow short timeouts for tests; production default remains 120s.
    const timeoutMs = Math.max(20, Number(input.timeoutMs) || 120_000);
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      resolve({ action: "cancel" });
    }, timeoutMs);

    pending.set(id, {
      request,
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      timer,
    });

    try {
      emitter?.emit(request);
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      resolve({ action: "cancel" });
    }
  });
}

function parseRequestedSchema(schema: any): McpElicitationField[] {
  if (!schema || typeof schema !== "object") return [];
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const fields: McpElicitationField[] = [];

  for (const [name, raw] of Object.entries(properties as Record<string, any>)) {
    if (!raw || typeof raw !== "object") continue;
    const typeRaw = String(raw.type || "string");
    let type: McpElicitationField["type"] = "string";
    if (typeRaw === "boolean") type = "boolean";
    else if (typeRaw === "number") type = "number";
    else if (typeRaw === "integer") type = "integer";
    else if (typeRaw === "array") type = "array";
    else if (Array.isArray(raw.enum) || Array.isArray(raw.oneOf)) type = "enum";

    const enumValues: string[] = Array.isArray(raw.enum)
      ? raw.enum.map(String)
      : Array.isArray(raw.oneOf)
        ? raw.oneOf.map((o: any) => String(o?.const ?? o?.title ?? "")).filter(Boolean)
        : [];

    fields.push({
      name,
      type,
      title: typeof raw.title === "string" ? raw.title : name,
      description: typeof raw.description === "string" ? raw.description : undefined,
      required: required.has(name),
      enum: enumValues.length ? enumValues : undefined,
      enumNames: Array.isArray(raw.enumNames) ? raw.enumNames.map(String) : undefined,
      default: raw.default,
      format: typeof raw.format === "string" ? raw.format : undefined,
      secret: raw.format === "password" || /secret|token|password|api.?key/i.test(name),
    });
  }
  return fields;
}
