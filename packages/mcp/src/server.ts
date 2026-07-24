import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { AiHubError, createToolExecutionContext, createToolRegistry, toAiHubErrorPayload, ToolWriteExecutor, type ToolSpec } from "@ai-hub/agent-trade-core";

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
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function toMcpReadResult(data: unknown): CallToolResult {
  const payload = { ok: true, data };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
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
    description: `${tool.description}${tool.operation === "read" ? " Successful MCP output is structured as { ok: true, data: ... }. For list results, use data.items and data.count; for object results, use data.value. Check data.dataType before formatting." : ""}`,
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

function isMcpVisible(tool: ToolSpec): boolean {
  return tool.mcpVisible !== false;
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
export function createServer(profileName: string | undefined, readOnly: boolean): Server {
  const registry = createToolRegistry();
  const writeExecutor = new ToolWriteExecutor(registry);
  const server = new Server(
    { name: "ai-hub-agent-trade", version: "0.1.8" },
    {
      capabilities: { tools: {} },
      instructions: "Every successful read-tool response provides both JSON text and MCP structuredContent in the envelope { ok: true, data: ... }. All read-tool data is normalized: dataType=array means use data.items and data.count; dataType=object or scalar means use data.value; dataType=null means no value. Inspect data.dataType before formatting and never assume undocumented nested keys. For symbol lookup, use market_search_symbols. It returns an object whose bounded matches are at data.value.items; the complete raw symbols payload is intentionally unavailable in MCP. For broad market questions, call market_get_ticker_summary, market_get_depth_summary, market_get_trades_summary, or market_get_klines_summary instead of fetching large raw payloads. Account types are fixed: 1=Spot, 2=Isolated Margin, 3=Cross Margin, 4=C2C, 5=Derivatives. Never call account type 2 Derivatives. For Spot to Derivatives, use account_prepare_transfer with fromAccount=EXCHANGE and toAccount=FUTURE. Use wallet_prepare_universal_transfer for margin or C2C; account type 2 requires its isolated-margin trading pair in symbol. Prepare/confirm tools return their documented action payload directly in data. For every state-changing action, call only a spot_prepare_* or margin_prepare_* tool first and show its exact summary to the user. Stop and wait for a new, explicit user confirmation message. Only then call confirm_action with that new message verbatim in userConfirmation. Never call prepare and confirm consecutively for one user instruction; never infer confirmation from prior intent, silence, or an Agent-generated message. For spot and margin orders, MARKET BUY always uses quoteAmount (the quote asset to spend); MARKET SELL uses baseQuantity (the base asset to sell). Never reinterpret a requested base quantity as quoteAmount."
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: CAPABILITIES_TOOL,
        title: "Server Capabilities Snapshot",
        description: "Return the available local profile and Tool Registry capability snapshot.",
        inputSchema: { type: "object", additionalProperties: false },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      },
      ...registry.list({ readOnly }).filter(isMcpVisible).flatMap((tool) => tool.operation === "write" ? [toPrepareMcpTool(tool)] : [toMcpTool(tool)]),
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
      const context = await createToolExecutionContext(profileName);
      if (request.params.name === CAPABILITIES_TOOL) {
        return result({
          ok: true,
          data: {
            profile: { name: context.profile.name, host: new URL(context.profile.openApiBaseUrl).host, configVersion: context.profile.configVersion },
            readOnly,
            capabilities: registry.capabilities(context, { readOnly }).filter((capability) => isMcpVisible(registry.byName(capability.name)))
          }
        });
      }
      if (request.params.name === CONFIRM_ACTION_TOOL) {
        const input = request.params.arguments ?? {};
        if (typeof input.confirmationId !== "string" || typeof input.userConfirmation !== "string" || !input.userConfirmation.trim()) {
          throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "confirmationId and a non-empty userConfirmation are required.");
        }
        return result({ ok: true, data: await writeExecutor.confirm(input.confirmationId, input.userConfirmation, context) });
      }
      const preparedTool = registry.list({ readOnly: false }).find((tool) => tool.operation === "write" && prepareToolName(tool) === request.params.name);
      if (preparedTool) {
        return result({ ok: true, data: await writeExecutor.prepare(preparedTool.name, request.params.arguments ?? {}, context) });
      }
      const tool = registry.byName(request.params.name, { readOnly });
      if (!isMcpVisible(tool)) {
        throw new AiHubError("AI_HUB_TOOL_NOT_AVAILABLE", `Tool "${request.params.name}" is not available through MCP. Use market_search_symbols for symbol lookup.`);
      }
      const data = await registry.execute(request.params.name, request.params.arguments ?? {}, context, { readOnly });
      return toMcpReadResult(formatMcpData(data));
    } catch (error) {
      return toMcpErrorResult(error);
    }
  });

  return server;
}
