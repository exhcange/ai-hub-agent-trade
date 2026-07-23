import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { AiHubError, createToolExecutionContext, createToolRegistry, toAiHubErrorPayload, ToolWriteExecutor, type ToolSpec } from "@ai-hub/agent-trade-core";

const CAPABILITIES_TOOL = "system_get_capabilities";
const CONFIRM_ACTION_TOOL = "confirm_action";

function result(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
export function createServer(profileName: string | undefined, readOnly: boolean): Server {
  const registry = createToolRegistry();
  const writeExecutor = new ToolWriteExecutor(registry);
  const server = new Server(
    { name: "ai-hub-agent-trade", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: "For every state-changing action, call only a spot_prepare_* tool first and show its exact summary to the user. Stop and wait for a new, explicit user confirmation message. Only then call confirm_action with that new message verbatim in userConfirmation. Never call prepare and confirm consecutively for one user instruction; never infer confirmation from prior intent, silence, or an Agent-generated message."
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
      const context = await createToolExecutionContext(profileName);
      if (request.params.name === CAPABILITIES_TOOL) {
        return result({
          ok: true,
          data: {
            profile: { name: context.profile.name, host: new URL(context.profile.openApiBaseUrl).host, configVersion: context.profile.configVersion },
            readOnly,
            capabilities: registry.capabilities(context, { readOnly })
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
        return result({ ok: true, data: writeExecutor.prepare(preparedTool.name, request.params.arguments ?? {}, context) });
      }
      const data = await registry.execute(request.params.name, request.params.arguments ?? {}, context, { readOnly });
      return result({ ok: true, data });
    } catch (error) {
      return toMcpErrorResult(error);
    }
  });

  return server;
}
