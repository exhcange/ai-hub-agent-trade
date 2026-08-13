import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { AI_HUB_RELEASE_VERSION, AiHubError, createRequestId, createToolExecutionContext, createToolRegistry, DEFAULT_MCP_RESPONSE_MODE, DEFAULT_MCP_TOOLSET, mcpRoutingInstructions, selectMcpToolset, toAiHubErrorPayload, ToolWriteExecutor, type McpResponseMode, type McpToolset, type ToolSpec } from "@ai-hub/agent-trade-core";

const CONFIRM_ACTION_TOOL = "confirm_action";
const SYSTEM_CAPABILITIES_TOOL = "system_get_capabilities";
const SEMANTIC_INPUT_FIELDS = new Set(["quoteAmount", "baseQuantity", "price", "triggerPrice", "side", "type", "orders", "amount", "address", "fromAccountType", "toAccountType", "isolated", "nonZeroOnly"]);

const READ_OUTPUT_SCHEMA: Tool["outputSchema"] = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
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

/** Read text and structuredContent intentionally share one parseable envelope. */
export function toMcpReadResult(data: unknown, _responseMode: McpResponseMode = DEFAULT_MCP_RESPONSE_MODE): CallToolResult {
  const payload = { ok: true, data: formatMcpData(data) };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload
  };
}

/** Stable discriminated read envelope used by every MCP read Tool. */
export function formatMcpData(data: unknown): unknown {
  if (Array.isArray(data)) return { dataType: "array", items: data, count: data.length };
  if (data === null) return { dataType: "null" };
  if (typeof data === "object") return { dataType: "object", value: data };
  return { dataType: "scalar", value: data };
}

export function toMcpErrorResult(error: unknown, requestId?: string): CallToolResult {
  const payload = toAiHubErrorPayload(error, { requestId });
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, ...payload }) }] };
}

function outputSchemaFor(_tool: ToolSpec): Tool["outputSchema"] {
  return READ_OUTPUT_SCHEMA;
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

/**
 * Claude Code, Claude Desktop, and OpenClaw may serialize omitted optional
 * string properties as empty strings. Remove schema-declared optional blank
 * strings, including nested array items. Unknown blank strings are also
 * removed for clients that cached an older schema; required or nonblank
 * unknown values remain for authoritative Core validation.
 */
export function normalizeMcpArguments(input: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    const propertySchema = properties[name];
    const definition = propertySchema && typeof propertySchema === "object" && !Array.isArray(propertySchema)
      ? propertySchema as Record<string, unknown>
      : undefined;
    if (typeof value === "string" && !value.trim() && !required.has(name) && (!definition || definition.type === "string")) continue;
    if (Array.isArray(value) && definition?.type === "array" && definition.items && typeof definition.items === "object" && !Array.isArray(definition.items)) {
      result[name] = value.map((item) => item && typeof item === "object" && !Array.isArray(item)
        ? normalizeMcpArguments(item as Record<string, unknown>, definition.items as Record<string, unknown>)
        : item);
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && definition?.type === "object") {
      result[name] = normalizeMcpArguments(value as Record<string, unknown>, definition);
      continue;
    }
    result[name] = value;
  }
  return result;
}

function writeDescription(tool: ToolSpec): string {
  if (tool.module === "spot-margin") {
    return "Spot margin; mode required; no derivatives or leverage multiplier. Preview.";
  }
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
    outputSchema: outputSchemaFor(tool),
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
  const { outputSchema: _readOutputSchema, ...base } = toMcpTool(tool);
  return {
    ...base,
    name: prepareToolName(tool),
    title: `Prepare ${tool.title}`,
    description: compactDescription(writeDescription(tool)),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  };
}

function systemCapabilitiesTool(): Tool {
  return {
    name: SYSTEM_CAPABILITIES_TOOL,
    inputSchema: { type: "object" },
    outputSchema: READ_OUTPUT_SCHEMA
  };
}

export function buildSystemCapabilities(
  profile: string,
  tools: readonly ToolSpec[],
  toolset: McpToolset,
  responseMode: McpResponseMode,
  readOnly: boolean
): Record<string, unknown> {
  const exposed = readOnly ? tools.filter((tool) => tool.operation === "read") : tools;
  const read = exposed.filter((tool) => tool.operation === "read").length;
  const write = exposed.filter((tool) => tool.operation === "write").length;
  return {
    profile,
    toolset,
    responseMode,
    serviceVersion: AI_HUB_RELEASE_VERSION,
    readOnly,
    productScope: {
      spot: true,
      spotMargin: { isolated: true, cross: true, explicitLeverageMultiplier: false },
      derivatives: false
    },
    modules: [...new Set(exposed.map((tool) => tool.module))].sort(),
    toolCounts: { read, write, total: read + write }
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
      instructions: `Read results use the same discriminated JSON envelope in content.text and structuredContent. ${mcpRoutingInstructions()} Prepare tools only preview and require a new user confirmation before confirm_action.`
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      systemCapabilitiesTool(),
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
    const requestId = createRequestId();
    const requestStartedAt = performance.now();
    const debugTiming = timingEnabled();
    const timing: RequestTiming = { contextLoadMs: 0, openApiMs: 0, handlerMs: 0, totalMs: 0 };
    const loadContext = async () => {
      const startedAt = performance.now();
      try {
        return await createToolExecutionContext(profileName, debugTiming ? {
          onRequestTiming: (elapsed) => { timing.openApiMs += elapsed; }
        } : undefined, requestId);
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
      if (request.params.name === SYSTEM_CAPABILITIES_TOOL) {
        const input = request.params.arguments ?? {};
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 0) {
          throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${SYSTEM_CAPABILITIES_TOOL} does not accept arguments.`);
        }
        const context = await loadContext();
        return toMcpReadResult(buildSystemCapabilities(context.profile.name, registry.list(), toolset, responseMode, readOnly), responseMode);
      }
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
        const input = normalizeMcpArguments(request.params.arguments ?? {}, preparedTool.inputSchema as Record<string, unknown>);
        return result({ ok: true, data: await runHandler(() => writeExecutor.prepare(preparedTool.name, input, context)) });
      }
      const tool = registry.byName(request.params.name, { readOnly });
      const context = await loadContext();
      const input = normalizeMcpArguments(request.params.arguments ?? {}, tool.inputSchema as Record<string, unknown>);
      const data = await runHandler(() => registry.execute(request.params.name, input, context, { readOnly }));
      return toMcpReadResult(data, responseMode);
    } catch (error) {
      return toMcpErrorResult(error, requestId);
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
