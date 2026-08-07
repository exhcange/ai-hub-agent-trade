import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { AI_HUB_RELEASE_VERSION, AiHubError, createToolExecutionContext, createToolRegistry, DEFAULT_MCP_RESPONSE_MODE, DEFAULT_MCP_TOOLSET, mcpRoutingInstructions, selectMcpToolset, toAiHubErrorPayload, ToolWriteExecutor, type McpResponseMode, type McpToolset, type ToolSpec } from "@ai-hub/agent-trade-core";

const CONFIRM_ACTION_TOOL = "confirm_action";
const SEMANTIC_INPUT_FIELDS = new Set(["quoteAmount", "baseQuantity", "price", "triggerPrice", "side", "type", "orders", "amount", "address", "fromAccountType", "toAccountType", "isolated", "nonZeroOnly"]);

const ASSET_BALANCE_OUTPUT_SCHEMA: Tool["outputSchema"] = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    data: {
      type: "object",
      properties: {
        asset: { type: "string" },
        available: { type: "string" },
        frozen: { type: "string" },
        total: { type: "string" },
        found: { type: "boolean" }
      },
      required: ["asset", "available", "frozen", "total", "found"]
    }
  },
  required: ["ok", "data"]
};

const BALANCE_LIST_OUTPUT_SCHEMA: Tool["outputSchema"] = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    data: {
      type: "object",
      properties: {
        balances: { type: "array" },
        count: { type: "integer", minimum: 0 },
        truncated: { type: "boolean" }
      },
      required: ["balances", "count", "truncated"]
    }
  },
  required: ["ok", "data"]
};

function result(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

interface RequestTiming {
  contextLoadMs: number;
  openApiMs: number;
  handlerMs: number;
  totalMs: number;
}

function timingEnabled(): boolean {
  return process.env.AI_HUB_DEBUG_TIMING === "1";
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

/** Emits only anonymous elapsed-time numbers to stderr when explicitly enabled. */
function writeTiming(timing: RequestTiming): void {
  process.stderr.write(`${JSON.stringify(timing)}\n`);
}

function compactReadText(data: unknown): string {
  let summary = "Result available in structuredContent.";
  if (Array.isArray(data)) summary = `Returned ${data.length} items.`;
  else if (data && typeof data === "object") {
    const value = data as Record<string, unknown>;
    if (Array.isArray(value.balances) && typeof value.count === "number") {
      summary = `Returned ${value.count} balances${value.truncated === true ? "; more results were truncated." : "."}`;
    } else if (typeof value.count === "number") {
      summary = `Returned ${value.count} items.`;
    } else if (Array.isArray(value.items)) {
      summary = `Returned ${value.items.length} items.`;
    }
  }
  return JSON.stringify({ ok: true, summary });
}

/** Read payloads retain their native compact Core shape in structured content. */
export function toMcpReadResult(data: unknown, responseMode: McpResponseMode = DEFAULT_MCP_RESPONSE_MODE): CallToolResult {
  const payload = { ok: true, data };
  return {
    content: [{ type: "text", text: responseMode === "compat" ? JSON.stringify(payload) : compactReadText(data) }],
    structuredContent: payload
  };
}

/** Compatibility export: MCP no longer wraps native Core results in a dataType envelope. */
export function formatMcpData(data: unknown): unknown {
  return data;
}

export function toMcpErrorResult(error: unknown): CallToolResult {
  const payload = toAiHubErrorPayload(error);
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, ...payload }) }] };
}

function outputSchemaFor(tool: ToolSpec): Tool["outputSchema"] | undefined {
  if (tool.name === "account_get_asset_balance") return ASSET_BALANCE_OUTPUT_SCHEMA;
  if (tool.name === "account_list_balances") return BALANCE_LIST_OUTPUT_SCHEMA;
  return undefined;
}

function compactDescription(description: string): string {
  const normalized = description
    .replace(/\bthe configured tenant OpenAPI\b/gi, "OpenAPI")
    .replace(/\bconfigured tenant OpenAPI\b/gi, "OpenAPI")
    .replace(/\s+/g, " ")
    .trim();
  // Keep each listing short: tools/list is injected into the Agent context on
  // every MCP session, while the server-level instructions carry the shared
  // routing rules.
  if (normalized.length <= 93) return normalized;
  return `${normalized.slice(0, 90).trimEnd()}...`;
}

function compactInputSchema(tool: ToolSpec): Tool["inputSchema"] {
  const properties = Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {}).map(([name, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [name, value];
    const property = { ...(value as Record<string, unknown>) };
    if (!SEMANTIC_INPUT_FIELDS.has(name)) delete property.description;
    return [name, property];
  }));
  return { ...tool.inputSchema, ...(Object.keys(properties).length ? { properties } : {}) } as Tool["inputSchema"];
}

function writeDescription(tool: ToolSpec): string {
  const unitRule = tool.name === "spot_batch_place_orders" ? " MARKET BUY items spend quoteAmount; other items use baseQuantity."
    : tool.name.includes("stop_market_buy") ? " STOP_MARKET BUY spends quoteAmount and requires triggerPrice."
    : tool.name.includes("stop_market_sell") ? " STOP_MARKET SELL uses baseQuantity and requires triggerPrice."
      : tool.name.includes("stop_limit") ? " STOP requires price and triggerPrice."
        : tool.name.endsWith("market_buy") ? " MARKET BUY spends quoteAmount."
          : tool.name.endsWith("market_sell") ? " MARKET SELL uses baseQuantity."
            : "";
  return `Preview only; no OpenAPI write.${unitRule} Stop for a NEW user confirmation, then call ${CONFIRM_ACTION_TOOL}.`;
}

function toMcpTool(tool: ToolSpec): Tool {
  const routing = tool.agentRouting?.selectionHint;
  return {
    name: tool.name,
    title: tool.title,
    description: compactDescription(routing ? `${tool.description} ${routing}` : tool.description),
    inputSchema: compactInputSchema(tool),
    ...(outputSchemaFor(tool) ? { outputSchema: outputSchemaFor(tool) } : {}),
    annotations: {
      readOnlyHint: tool.operation === "read",
      destructiveHint: tool.riskLevel === "high",
      idempotentHint: tool.operation === "read",
      openWorldHint: false
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
    description: compactDescription(writeDescription(tool)),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  };
}

/** stdio adapter only: Tool schemas, validation, permissions, and handlers come from Core. */
export function createServer(profileName: string | undefined, readOnly: boolean, toolset: McpToolset = DEFAULT_MCP_TOOLSET, responseMode: McpResponseMode = DEFAULT_MCP_RESPONSE_MODE): Server {
  const allTools = createToolRegistry();
  const registry = createToolRegistry(selectMcpToolset(allTools.list(), toolset));
  const writeExecutor = new ToolWriteExecutor(registry);
  const server = new Server(
    { name: "ai-hub-agent-trade", version: AI_HUB_RELEASE_VERSION },
    {
      capabilities: { tools: {} },
      instructions: `Use structuredContent for reads. ${mcpRoutingInstructions()} Prepare tools only preview and require a new user confirmation before confirm_action.`
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...registry.list({ readOnly }).flatMap((tool) => tool.operation === "write" ? [toPrepareMcpTool(tool)] : [toMcpTool(tool)]),
      ...(readOnly ? [] : [{
        name: CONFIRM_ACTION_TOOL,
        title: "Confirm Prepared Action",
        description: "Execute one preview only after a NEW explicit user confirmation.",
        inputSchema: { type: "object", properties: { confirmationId: { type: "string" }, userConfirmation: { type: "string", minLength: 1 } }, required: ["confirmationId", "userConfirmation"], additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
      } satisfies Tool])
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const requestStartedAt = performance.now();
    const debugTiming = timingEnabled();
    const timing: RequestTiming = { contextLoadMs: 0, openApiMs: 0, handlerMs: 0, totalMs: 0 };
    const loadContext = async () => {
      const startedAt = performance.now();
      try {
        return await createToolExecutionContext(profileName, debugTiming ? {
          onRequestTiming: (elapsed) => { timing.openApiMs += elapsed; }
        } : undefined);
      } finally {
        timing.contextLoadMs += elapsedMs(startedAt);
      }
    };
    const runHandler = async <T>(handler: () => Promise<T>): Promise<T> => {
      const startedAt = performance.now();
      try {
        return await handler();
      } finally {
        timing.handlerMs += elapsedMs(startedAt);
      }
    };
    try {
      if (request.params.name === CONFIRM_ACTION_TOOL) {
        if (readOnly) throw new AiHubError("AI_HUB_TOOL_NOT_AVAILABLE", `Tool "${CONFIRM_ACTION_TOOL}" is not available in this server session.`);
        const input = request.params.arguments ?? {};
        if (typeof input.confirmationId !== "string" || typeof input.userConfirmation !== "string" || !input.userConfirmation.trim()) {
          throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "confirmationId and a non-empty userConfirmation are required.");
        }
        const confirmationId = input.confirmationId;
        const userConfirmation = input.userConfirmation;
        const context = await loadContext();
        return result({ ok: true, data: await runHandler(() => writeExecutor.confirm(confirmationId, userConfirmation, context)) });
      }
      const preparedTool = readOnly ? undefined : registry.list().find((tool) => tool.operation === "write" && prepareToolName(tool) === request.params.name);
      if (preparedTool) {
        const context = await loadContext();
        return result({ ok: true, data: await runHandler(() => writeExecutor.prepare(preparedTool.name, request.params.arguments ?? {}, context)) });
      }
      const tool = registry.byName(request.params.name, { readOnly });
      const context = await loadContext();
      const data = await runHandler(() => registry.execute(request.params.name, request.params.arguments ?? {}, context, { readOnly }));
      return toMcpReadResult(data, responseMode);
    } catch (error) {
      return toMcpErrorResult(error);
    } finally {
      if (debugTiming) {
        timing.totalMs = elapsedMs(requestStartedAt);
        timing.openApiMs = Math.round(timing.openApiMs * 100) / 100;
        writeTiming(timing);
      }
    }
  });

  return server;
}
