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
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function toMcpReadResult(data: unknown): CallToolResult {
  const payload = { ok: true, data };
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
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
        const visibleTools = registry.list({ readOnly }).filter(isMcpVisible);
        const toolCounts = visibleTools.reduce<Record<string, number>>((counts, tool) => {
          counts[tool.operation] = (counts[tool.operation] ?? 0) + 1;
          return counts;
        }, {});
        return result({
          ok: true,
          data: {
            profile: { name: context.profile.name, host: new URL(context.profile.openApiBaseUrl).host, configVersion: context.profile.configVersion },
            readOnly,
            serviceVersion: "0.1.11",
            toolCounts
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
        throw new AiHubError("AI_HUB_TOOL_NOT_AVAILABLE", `Tool "${request.params.name}" is not available through MCP. Use the corresponding bounded summary or symbol-browsing tool instead.`);
      }
      const data = await registry.execute(request.params.name, request.params.arguments ?? {}, context, { readOnly });
      return toMcpReadResult(formatMcpData(data));
    } catch (error) {
      return toMcpErrorResult(error);
    }
  });

  return server;
}
