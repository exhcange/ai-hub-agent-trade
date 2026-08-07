import { ConfirmationService, type ConfirmationStore, type PreparedAction } from "../confirmation.js";
import { FileAuditLogger, type AuditLogger } from "../audit-log.js";
import { AiHubError, toAiHubErrorPayload } from "../errors.js";
import { confirmationContext } from "./execution-context.js";
import type { ToolExecutionContext } from "./tool-spec.js";
import { ToolRegistry } from "./tool-registry.js";

/** The only Core entry point allowed to execute a write Tool. */
export class ToolWriteExecutor {
  public constructor(
    private readonly registry: ToolRegistry,
    private readonly confirmations: ConfirmationStore = new ConfirmationService(),
    private readonly audit: AuditLogger = new FileAuditLogger()
  ) {}

  public async prepare(name: string, input: unknown, context: ToolExecutionContext): Promise<PreparedAction> {
    const prepared = await this.registry.prepareWrite(name, input, context, this.confirmations);
    const tool = this.registry.byName(name);
    await this.audit.record({ event: "prepared", profile: context.profile.name, tool: name, confirmationId: prepared.confirmationId, requestHash: prepared.requestHash, openApi: tool.openApiContract! });
    return prepared;
  }

  public async confirm(confirmationId: string, userConfirmation: string, context: ToolExecutionContext): Promise<unknown> {
    const pending = await this.confirmations.confirm(confirmationId, userConfirmation, confirmationContext(context));
    const tool = this.registry.byName(pending.action);
    const entry = { profile: context.profile.name, tool: pending.action, confirmationId, requestHash: pending.requestHash, openApi: tool.openApiContract! };
    await this.audit.record({ event: "execution_started", ...entry });
    try {
      const result = await this.registry.executeConfirmed(pending.action, pending.payload, context);
      await this.audit.record({ event: "succeeded", ...entry });
      return result;
    } catch (error) {
      if (error instanceof AiHubError && error.code === "AI_HUB_OPENAPI_NETWORK_ERROR") {
        await this.audit.record({ event: "outcome_unknown", ...entry, errorCode: "AI_HUB_WRITE_RESULT_UNKNOWN" });
        throw new AiHubError("AI_HUB_WRITE_RESULT_UNKNOWN", "The request may have reached OpenAPI. Do not retry automatically; query by client order ID before taking another action.");
      }
      const payload = toAiHubErrorPayload(error);
      await this.audit.record({ event: "failed", ...entry, errorCode: typeof payload.code === "string" ? payload.code : undefined, upstreamCode: typeof payload.upstreamCode === "string" ? payload.upstreamCode : undefined });
      throw error;
    }
  }
}
