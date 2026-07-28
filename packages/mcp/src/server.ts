import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { AiHubError, createToolExecutionContext, createToolRegistry, DEFAULT_MCP_RESPONSE_MODE, DEFAULT_MCP_TOOLSET, selectMcpToolset, toAiHubErrorPayload, ToolWriteExecutor, type McpResponseMode, type McpToolset, type ToolSpec } from "@ai-hub/agent-trade-core";

const CAPABILITIES_TOOL = "system_get_capabilities";
const CONFIRM_ACTION_TOOL = "confirm_action";
const READ_RESULT_OUTPUT_SCHEMA: Tool["outputSchema"] = {
  type: "object",
  properties: {
    ok: { type: "boolean", const: true },
    data: {
      type: "object",
      properties: {
        dataType: { type: "string", enum: ["array", "object", "scalar", "null"] },
        items: { type: "array" },
        count: { type: "integer", minimum: 0 },
        value: {}
      },
      required: ["dataType"]
    }
  },
  required: ["ok", "data"]
};

function result(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function numberField(value: Record<string, unknown>, ...names: string[]): number | undefined {
  for (const name of names) {
    const candidate = value[name];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Emits only routing metadata in text. Structured content stays authoritative,
 * while Agents can still tell a paged object from a scalar/object response
 * without parsing the full payload twice.
 */
function compactReadText(data: unknown): string {
  const envelope = data as { dataType?: unknown; count?: unknown; value?: unknown };
  const dataType = typeof envelope?.dataType === "string" ? envelope.dataType : "unknown";
  const compact: Record<string, unknown> = { dataType };

  if (typeof envelope?.count === "number") compact.count = envelope.count;
  if (dataType === "object" && envelope.value && typeof envelope.value === "object" && !Array.isArray(envelope.value)) {
    const value = envelope.value as Record<string, unknown>;
    const items = Array.isArray(value.items) ? value.items : undefined;
    const returnedCount = numberField(value, "returnedCount", "returnedSymbols") ?? items?.length;
    const totalCount = numberField(value, "totalCount", "totalSymbols", "matchedSymbols");
    if (returnedCount !== undefined) compact.returnedCount = returnedCount;
    if (totalCount !== undefined) compact.totalCount = totalCount;
    if (typeof value.nextOffset === "number" || value.nextOffset === null) compact.nextOffset = value.nextOffset;
    if (value.truncated === true) compact.truncated = true;
  }
  compact.summary = "Full result is available in structuredContent.";
  return JSON.stringify({ ok: true, data: compact });
}

export function toMcpReadResult(data: unknown, responseMode: McpResponseMode = DEFAULT_MCP_RESPONSE_MODE): CallToolResult {
  const payload = { ok: true, data };
  return {
    content: [{ type: "text", text: responseMode === "compat" ? JSON.stringify(payload) : compactReadText(data) }],
    structuredContent: payload
  };
}

/** Adapts every read response into a stable MCP response shape so Agents never need to infer raw API shape. */
export function formatMcpData(data: unknown): unknown {
  if (Array.isArray(data)) {
    return {
      dataType: "array",
      items: data,
      count: data.length
    };
  }
  if (data === null || data === undefined) return { dataType: "null", value: null };
  if (typeof data === "object") return { dataType: "object", value: data };
  return { dataType: "scalar", value: data };
}

export function toMcpErrorResult(error: unknown): CallToolResult {
  const payload = toAiHubErrorPayload(error);
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, ...payload }) }] };
}

function toMcpTool(tool: ToolSpec): Tool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.operation === "read" ? { outputSchema: READ_RESULT_OUTPUT_SCHEMA } : {}),
    annotations: {
      readOnlyHint: tool.operation === "read",
      destructiveHint: tool.riskLevel === "high",
      idempotentHint: tool.operation === "read",
      openWorldHint: true
    }
  };
}

function prepareToolName(tool: ToolSpec): string {
  const [prefix, ...rest] = tool.name.split("_");
  return `${prefix ?? "spot"}_prepare_${rest.join("_")}`;
}

function toPrepareMcpTool(tool: ToolSpec): Tool {
  return {
    ...toMcpTool(tool),
    name: prepareToolName(tool),
    title: `Prepare ${tool.title}`,
    description: `Validate and preview this state-changing request. It does not call OpenAPI. Stop after this call and wait for a NEW explicit user confirmation message before calling ${CONFIRM_ACTION_TOOL}.`,
    annotations: { readOnlyHint: false, destructiveHint: tool.riskLevel === "high", idempotentHint: true, openWorldHint: false }
  };
}

/** stdio adapter only: Tool schemas, validation, permissions, and handlers come from Core. */
export function createServer(profileName: string | undefined, readOnly: boolean, toolset: McpToolset = DEFAULT_MCP_TOOLSET, responseMode: McpResponseMode = DEFAULT_MCP_RESPONSE_MODE): Server {
  const allTools = createToolRegistry();
  const registry = createToolRegistry(selectMcpToolset(allTools.list(), toolset));
  const writeExecutor = new ToolWriteExecutor(registry);
  const server = new Server(
    { name: "ai-hub-agent-trade", version: "0.1.11" },
    {
      capabilities: { tools: {} },
      instructions: "Read results use {ok:true,data}; inspect data.dataType before reading fields. Use bounded summary tools for broad market requests. For writes, call a prepare tool, show its preview, stop for a new user message, then call confirm_action with that message. MARKET BUY uses quoteAmount; MARKET SELL uses baseQuantity."
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: CAPABILITIES_TOOL,
        title: "Server Capabilities Snapshot",
        description: "Return a compact local server status. Tool schemas are available through the MCP tool list.",
        inputSchema: { type: "object", additionalProperties: false },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      },
      ...registry.list({ readOnly }).flatMap((tool) => tool.operation === "write" ? [toPrepareMcpTool(tool)] : [toMcpTool(tool)]),
      ...(readOnly ? [] : [{
        name: CONFIRM_ACTION_TOOL,
        title: "Confirm Prepared Action",
        description: "Execute one previously prepared state-changing action exactly once, only after a new explicit user confirmation message received after the preview.",
        inputSchema: { type: "object", properties: { confirmationId: { type: "string" }, userConfirmation: { type: "string", minLength: 1, description: "The new explicit user confirmation message received after the prepare preview. Do not generate or infer this text." } }, required: ["confirmationId", "userConfirmation"], additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
      } satisfies Tool])
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (request.params.name === CAPABILITIES_TOOL) {
        const context = await createToolExecutionContext(profileName);
        const visibleTools = registry.list({ readOnly });
        const toolCounts = visibleTools.reduce<Record<string, number>>((counts, tool) => {
          counts[tool.operation] = (counts[tool.operation] ?? 0) + 1;
          return counts;
        }, {});
        return toMcpReadResult(formatMcpData({
            profile: { name: context.profile.name, host: new URL(context.profile.openApiBaseUrl).host, configVersion: context.profile.configVersion },
            toolset,
            responseMode,
            modules: [...new Set(visibleTools.map((tool) => tool.module))].sort(),
            readOnly,
            serviceVersion: "0.1.11",
            toolCounts
        }), responseMode);
      }
      if (request.params.name === CONFIRM_ACTION_TOOL) {
        if (readOnly) throw new AiHubError("AI_HUB_TOOL_NOT_AVAILABLE", `Tool "${CONFIRM_ACTION_TOOL}" is not available in this server session.`);
        const input = request.params.arguments ?? {};
        if (typeof input.confirmationId !== "string" || typeof input.userConfirmation !== "string" || !input.userConfirmation.trim()) {
          throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "confirmationId and a non-empty userConfirmation are required.");
        }
        const context = await createToolExecutionContext(profileName);
        return result({ ok: true, data: await writeExecutor.confirm(input.confirmationId, input.userConfirmation, context) });
      }
      const preparedTool = readOnly ? undefined : registry.list().find((tool) => tool.operation === "write" && prepareToolName(tool) === request.params.name);
      if (preparedTool) {
        const context = await createToolExecutionContext(profileName);
        return result({ ok: true, data: await writeExecutor.prepare(preparedTool.name, request.params.arguments ?? {}, context) });
      }
      const tool = registry.byName(request.params.name, { readOnly });
      const context = await createToolExecutionContext(profileName);
      const data = await registry.execute(request.params.name, request.params.arguments ?? {}, context, { readOnly });
      return toMcpReadResult(formatMcpData(data), responseMode);
    } catch (error) {
      return toMcpErrorResult(error);
    }
  });

  return server;
}
