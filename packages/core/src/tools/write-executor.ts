import { ConfirmationService, type PreparedAction } from "../confirmation.js";
import { AiHubError } from "../errors.js";
import { confirmationContext } from "./execution-context.js";
import type { ToolExecutionContext } from "./tool-spec.js";
import { ToolRegistry } from "./tool-registry.js";

/** The only Core entry point allowed to execute a write Tool. */
export class ToolWriteExecutor {
  public constructor(
    private readonly registry: ToolRegistry,
    private readonly confirmations = new ConfirmationService()
  ) {}

  public prepare(name: string, input: unknown, context: ToolExecutionContext): PreparedAction {
    return this.registry.prepareWrite(name, input, context, this.confirmations);
  }

  public async confirm(confirmationId: string, userConfirmation: string, context: ToolExecutionContext): Promise<unknown> {
    const pending = this.confirmations.confirm(confirmationId, userConfirmation, confirmationContext(context));
    try {
      return await this.registry.executeConfirmed(pending.action, pending.payload, context);
    } catch (error) {
      if (error instanceof AiHubError && error.code === "AI_HUB_OPENAPI_NETWORK_ERROR") {
        throw new AiHubError("AI_HUB_WRITE_RESULT_UNKNOWN", "The request may have reached OpenAPI. Do not retry automatically; query by client order ID before taking another action.");
      }
      throw error;
    }
  }
}
