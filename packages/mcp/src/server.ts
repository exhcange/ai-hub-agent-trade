import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { AiHubError, AiHubSpotApi, CredentialStore, type ResolvedProfile } from "@ai-hub/agent-trade-core";

const CAPABILITIES_TOOL = "system_get_capabilities";

function result(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const READ_TOOLS: Tool[] = [
  {
    name: "market_get_server_time",
    description: "Get server time from the configured tenant OpenAPI.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "market_get_symbols",
    description: "Get spot symbols from the configured tenant OpenAPI.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "market_get_ticker",
    description: "Get spot ticker data. Pass symbol or symbols when filtering is needed.",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, symbols: { type: "string" }, timeZone: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "market_get_depth",
    description: "Get the spot order book for one symbol.",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 100 } }, required: ["symbol"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "market_get_trades",
    description: "Get recent spot trades for one symbol.",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 1000 } }, required: ["symbol"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "spot_get_account",
    description: "Get the signed account overview for the configured profile. Requires credentials in the local credential manager.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }
];

function argumentsOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} is required.`);
  return value;
}

function numberOrDefault(args: Record<string, unknown>, name: string, fallback: number): number {
  const value = args[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} must be a number.`);
  return value;
}

function apiFor(profile: ResolvedProfile | undefined): AiHubSpotApi {
  if (!profile) throw new AiHubError("AI_HUB_PROFILE_NOT_FOUND", "No configured local profile is available.");
  return new AiHubSpotApi(profile.openApiBaseUrl);
}

async function callReadTool(name: string, profile: ResolvedProfile | undefined, args: Record<string, unknown>): Promise<unknown> {
  const api = apiFor(profile);
  switch (name) {
    case "market_get_server_time": return api.time();
    case "market_get_symbols": return api.symbols();
    case "market_get_ticker": return api.ticker({
      symbol: typeof args.symbol === "string" ? args.symbol : undefined,
      symbols: typeof args.symbols === "string" ? args.symbols : undefined,
      timeZone: typeof args.timeZone === "string" ? args.timeZone : undefined
    });
    case "market_get_depth": return api.depth(requiredString(args, "symbol"), numberOrDefault(args, "limit", 20));
    case "market_get_trades": return api.trades(requiredString(args, "symbol"), numberOrDefault(args, "limit", 100));
    case "spot_get_account": {
      if (!profile) throw new AiHubError("AI_HUB_PROFILE_NOT_FOUND", "No configured local profile is available.");
      const credentials = await new CredentialStore().get(profile.name);
      if (!credentials) throw new AiHubError("AI_HUB_CREDENTIAL_NOT_CONFIGURED", `Credentials are not configured for profile "${profile.name}".`);
      return api.account(credentials);
    }
    default: throw new AiHubError("AI_HUB_TOOL_NOT_AVAILABLE", "This tool is not available in the current server session.");
  }
}

export function createServer(profile: ResolvedProfile | undefined, readOnly: boolean): Server {
  const server = new Server(
    { name: "ai-hub-agent-trade", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: CAPABILITIES_TOOL,
      description: "Return the local server capability snapshot without making an OpenAPI request.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, ...READ_TOOLS]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (request.params.name === CAPABILITIES_TOOL) {
        return result({
          ok: true,
          data: {
            profileConfigured: Boolean(profile),
            profile: profile ? { name: profile.name, host: new URL(profile.openApiBaseUrl).host, configVersion: profile.configVersion } : null,
            readOnly,
            modules: ["spot-common", "spot-order", "spot-account", "spot-deposit-withdraw", "spot-sub-account"],
            writeToolsExposed: false
          }
        });
      }
      return result({ ok: true, data: await callReadTool(request.params.name, profile, argumentsOf(request.params.arguments)) });
    } catch (error) {
      const payload = error instanceof AiHubError
        ? { code: error.code, message: error.message }
        : { code: "AI_HUB_UNEXPECTED_ERROR", message: error instanceof Error ? error.message : "Unexpected error" };
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, ...payload }) }] };
    }
  });

  return server;
}
