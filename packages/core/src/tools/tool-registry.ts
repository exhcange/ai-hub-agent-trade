import { AiHubError } from "../errors.js";
import type { ConfirmationService, PreparedAction } from "../confirmation.js";
import { confirmationContext } from "./execution-context.js";
import { accountTools } from "./account-tools.js";
import { assetTools } from "./asset-tools.js";
import { marketTools } from "./market-tools.js";
import { marginTools } from "./margin-tools.js";
import { orderTools } from "./order-tools.js";
import { subAccountTools } from "./sub-account-tools.js";
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

export class ToolRegistry {
  private readonly toolsByName = new Map<string, ToolSpec>();
  private readonly toolsByCliPath = new Map<string, ToolSpec>();

  public constructor(tools: readonly ToolSpec[] = allTools) {
    for (const tool of tools) {
      const path = tool.cliPath.join(" ");
      if (this.toolsByName.has(tool.name) || this.toolsByCliPath.has(path)) {
        throw new AiHubError("AI_HUB_TOOL_DUPLICATE", `Duplicate tool registration: ${tool.name}.`);
      }
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
    return tool.handler(validInput, context);
  }

  public prepareWrite(name: string, input: unknown, context: ToolExecutionContext, confirmations: ConfirmationService): PreparedAction {
    const tool = this.byName(name);
    if (tool.operation !== "write" || !tool.writeSummary) throw new AiHubError("AI_HUB_TOOL_NOT_WRITE", `Tool "${name}" is not a confirmable write Tool.`);
    const validInput = tool.validate(input);
    return confirmations.prepare({
      action: tool.name,
      payload: validInput,
      context: confirmationContext(context),
      summary: tool.writeSummary(validInput)
    });
  }

  public async executeConfirmed(action: string, payload: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    const tool = this.byName(action);
    if (tool.operation !== "write") throw new AiHubError("AI_HUB_TOOL_NOT_WRITE", `Tool "${action}" is not a write Tool.`);
    const validInput = tool.validate(payload);
    return tool.handler(validInput, context);
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

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
