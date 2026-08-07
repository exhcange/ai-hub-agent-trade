import { AiHubError } from "../errors.js";
import type { ConfirmationPreparer, PreparedAction } from "../confirmation.js";
import { confirmationContext } from "./execution-context.js";
import { accountTools } from "./account-tools.js";
import { assetTools } from "./asset-tools.js";
import { marketTools } from "./market-tools.js";
import { marginTools } from "./margin-tools.js";
import { orderTools } from "./order-tools.js";
import { subAccountTools } from "./sub-account-tools.js";
import { truncateUnpagedListResponse, withListLimit } from "./list-limit.js";
import { withToolMetadata } from "./tool-metadata.js";
import type { ToolExecutionContext, ToolSpec } from "./tool-spec.js";

export interface ToolListOptions {
  readOnly?: boolean;
}

export interface ToolCapability {
  name: string;
  module: ToolSpec["module"];
  operation: ToolSpec["operation"];
  riskLevel: ToolSpec["riskLevel"];
  status: "enabled" | "requires_auth" | "disabled";
}

const allTools = [...marketTools, ...accountTools, ...orderTools, ...marginTools, ...assetTools, ...subAccountTools];

/**
 * Gives every write preview one stable shape before it reaches CLI/MCP.
 * Tool-specific summaries may add richer fields, but they cannot omit the
 * confirmation state or accidentally claim a preview has already executed.
 */
function withStandardPreview(summary: Record<string, unknown>, prepared: PreparedAction): Record<string, unknown> {
  return {
    ...summary,
    executionMode: "LIVE",
    executed: false,
    requiresNewUserConfirmation: true,
    symbol: summary.symbol ?? null,
    apiSymbol: summary.apiSymbol ?? null,
    side: summary.side ?? null,
    type: summary.type ?? null,
    quantityOrAmount: summary.quantityOrAmount ?? null,
    priceOrMarket: summary.priceOrMarket ?? { mode: "NOT_APPLICABLE" },
    estimatedNotional: summary.estimatedNotional ?? { amount: null, status: "not_applicable" },
    confirmationId: prepared.confirmationId,
    expiresAt: prepared.expiresAt
  };
}

function assertListLimitSchema(tool: ToolSpec): void {
  const limit = tool.listLimit;
  if (!limit) return;
  const property = tool.inputSchema.properties?.[limit.field] as { type?: unknown; minimum?: unknown; maximum?: unknown } | undefined;
  if (!property || property.type !== "integer" || property.minimum !== 1 || property.maximum !== limit.maximum) {
    throw new AiHubError("AI_HUB_TOOL_LIST_LIMIT_INVALID", `Tool "${tool.name}" must expose its declared ${limit.field} range in inputSchema.`);
  }
}

export class ToolRegistry {
  private readonly toolsByName = new Map<string, ToolSpec>();
  private readonly toolsByCliPath = new Map<string, ToolSpec>();

  public constructor(tools: readonly ToolSpec[] = allTools) {
    for (const tool of tools.map(withListLimit).map(withToolMetadata)) {
      const path = tool.cliPath.join(" ");
      if (this.toolsByName.has(tool.name) || this.toolsByCliPath.has(path)) {
        throw new AiHubError("AI_HUB_TOOL_DUPLICATE", `Duplicate tool registration: ${tool.name}.`);
      }
      assertListLimitSchema(tool);
      this.toolsByName.set(tool.name, tool);
      this.toolsByCliPath.set(path, tool);
    }
  }

  public list(options: ToolListOptions = {}): ToolSpec[] {
    return [...this.toolsByName.values()].filter((tool) => !options.readOnly || tool.operation === "read");
  }

  public byName(name: string, options: ToolListOptions = {}): ToolSpec {
    const tool = this.toolsByName.get(name);
    if (!tool || (options.readOnly && tool.operation !== "read")) {
      throw new AiHubError("AI_HUB_TOOL_NOT_AVAILABLE", `Tool "${name}" is not available in this server session.`);
    }
    return tool;
  }

  public byCliPath(path: readonly string[], options: ToolListOptions = {}): ToolSpec {
    const tool = this.toolsByCliPath.get(path.join(" "));
    if (!tool || (options.readOnly && tool.operation !== "read")) {
      throw new AiHubError("AI_HUB_TOOL_NOT_AVAILABLE", `Command "${path.join(" ")}" is not available.`);
    }
    return tool;
  }

  public async execute(name: string, input: unknown, context: ToolExecutionContext, options: ToolListOptions = {}): Promise<unknown> {
    const tool = this.byName(name, options);
    if (tool.operation === "write") throw new AiHubError("AI_HUB_WRITE_CONFIRMATION_REQUIRED", `Tool "${name}" must be executed through confirmation.`);
    const validInput = tool.validate(input);
    const response = await tool.handler(validInput, context);
    const normalized = tool.normalizeResult ? tool.normalizeResult(response, validInput) : response;
    return tool.unpagedListLimit
      ? truncateUnpagedListResponse(normalized, tool.unpagedListLimit, validInput as Record<string, unknown>)
      : normalized;
  }

  public async prepareWrite(name: string, input: unknown, context: ToolExecutionContext, confirmations: ConfirmationPreparer): Promise<PreparedAction> {
    const tool = this.byName(name);
    if (tool.operation !== "write" || !tool.writeSummary) throw new AiHubError("AI_HUB_TOOL_NOT_WRITE", `Tool "${name}" is not a confirmable write Tool.`);
    const validInput = tool.validate(input);
    const preflightInput = tool.preflight ? await tool.preflight(validInput, context) : validInput;
    const prepared = await confirmations.prepare({
      action: tool.name,
      payload: preflightInput,
      context: confirmationContext(context),
      summary: tool.writeSummary(preflightInput)
    });
    return { ...prepared, summary: withStandardPreview(prepared.summary, prepared) };
  }

  public async executeConfirmed(action: string, payload: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    const tool = this.byName(action);
    if (tool.operation !== "write") throw new AiHubError("AI_HUB_TOOL_NOT_WRITE", `Tool "${action}" is not a write Tool.`);
    // The payload was validated and bound to the one-time confirmation during prepareWrite.
    // Do not validate it again: that could re-interpret internal normalized fields and change intent.
    // A confirmPreflight may only reject a now-risky request; it must not alter it.
    if (tool.confirmPreflight) await tool.confirmPreflight(payload as never, context);
    const response = await tool.handler(payload as never, context);
    return tool.normalizeResult ? tool.normalizeResult(response, payload as never) : response;
  }

  public capabilities(context: ToolExecutionContext, options: ToolListOptions = {}): ToolCapability[] {
    return this.list(options).map((tool) => ({
      name: tool.name,
      module: tool.module,
      operation: tool.operation,
      riskLevel: tool.riskLevel,
      status: tool.access === "signed" && !context.credentials ? "requires_auth" : "enabled"
    }));
  }
}

export function createToolRegistry(tools?: readonly ToolSpec[]): ToolRegistry {
  return new ToolRegistry(tools);
}
