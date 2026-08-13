import { ConfirmationService, type ConfirmationStore, type PreparedAction } from "../confirmation.js";
import { FileAuditLogger, type AuditLogger } from "../audit-log.js";
import { AiHubError, createRequestId, OpenApiBusinessError, toAiHubErrorPayload } from "../errors.js";
import { confirmationContext } from "./execution-context.js";
import type { ToolExecutionContext } from "./tool-spec.js";
import { ToolRegistry } from "./tool-registry.js";
import { MemoryUnresolvedWriteStore, type UnresolvedWriteStore } from "../unresolved-write.js";

const RECONCILABLE_SPOT_ORDER_TOOLS = new Set([
  "spot_market_buy", "spot_market_sell", "spot_sell_available", "spot_limit_order",
  "spot_stop_limit_order", "spot_stop_market_buy", "spot_stop_market_sell"
]);

function unresolvedStore(context: ToolExecutionContext, fallback: UnresolvedWriteStore): UnresolvedWriteStore {
  return context.unresolvedWrites ?? fallback;
}

/** The only Core entry point allowed to execute a write Tool. */
export class ToolWriteExecutor {
  public constructor(
    private readonly registry: ToolRegistry,
    private readonly confirmations: ConfirmationStore = new ConfirmationService(),
    private readonly audit: AuditLogger = new FileAuditLogger(),
    private readonly unresolved: UnresolvedWriteStore = new MemoryUnresolvedWriteStore()
  ) {}

  public async prepare(name: string, input: unknown, context: ToolExecutionContext): Promise<PreparedAction> {
    const prepared = await this.registry.prepareWrite(name, input, context, this.confirmations, (action, payload) =>
      unresolvedStore(context, this.unresolved).assertNoUnresolved(context.profile.name, action, payload));
    const tool = this.registry.byName(name);
    await this.audit.record({ event: "prepared", profile: context.profile.name, tool: name, confirmationId: prepared.confirmationId, requestHash: prepared.requestHash, requestId: context.requestId ?? createRequestId(), openApi: tool.openApiContract! });
    return prepared;
  }

  public async confirm(confirmationId: string, userConfirmation: string, context: ToolExecutionContext): Promise<unknown> {
    const pending = await this.confirmations.confirm(confirmationId, userConfirmation, confirmationContext(context));
    const tool = this.registry.byName(pending.action);
    const entry = { profile: context.profile.name, tool: pending.action, confirmationId, requestHash: pending.requestHash, requestId: context.requestId ?? createRequestId(), openApi: tool.openApiContract! };
    await this.audit.record({ event: "execution_started", ...entry });
    try {
      const result = await this.registry.executeConfirmed(pending.action, pending.payload, context);
      await this.audit.record({ event: "succeeded", ...entry });
      return result;
    } catch (error) {
      if ((error instanceof AiHubError && error.code === "AI_HUB_OPENAPI_NETWORK_ERROR")
        || (error instanceof OpenApiBusinessError && error.diagnosis.writeOutcomeUnknown)) {
        const symbol = typeof pending.payload.symbol === "string" ? pending.payload.symbol : undefined;
        const newClientOrderId = typeof pending.payload.newClientOrderId === "string" ? pending.payload.newClientOrderId : undefined;
        const store = unresolvedStore(context, this.unresolved);
        if (RECONCILABLE_SPOT_ORDER_TOOLS.has(pending.action) && symbol && newClientOrderId && context.credentials) {
          try {
            const order = await context.api.getOrder({ symbol, newClientOrderId }, context.credentials);
            await store.resolve(context.profile.name, symbol, newClientOrderId);
            await this.audit.record({ event: "succeeded", ...entry });
            return { reconciled: true, writeOutcomeUnknown: false, reconciliationTool: "spot_get_order", symbol, newClientOrderId, order };
          } catch (_reconciliationError) {
            // One read-only reconciliation attempt is allowed. ORDER_NOT_FOUND,
            // another network failure, or any indeterminate response remains UNKNOWN.
          }
        }
        await store.recordUnknown(context.profile.name, pending.action, pending.payload);
        await this.audit.record({ event: "outcome_unknown", ...entry, errorCode: "AI_HUB_WRITE_RESULT_UNKNOWN" });
        throw new AiHubError(
          "AI_HUB_WRITE_RESULT_UNKNOWN",
          "The request may have reached OpenAPI. Do not retry automatically; query by client order ID before taking another action.",
          { writeOutcomeUnknown: true, ...(symbol ? { symbol } : {}), ...(newClientOrderId ? { newClientOrderId } : {}), ...(symbol && newClientOrderId ? { reconciliationTool: "spot_get_order" } : {}) }
        );
      }
      const payload = toAiHubErrorPayload(error);
      await this.audit.record({ event: "failed", ...entry, errorCode: typeof payload.code === "string" ? payload.code : undefined, upstreamCode: typeof payload.upstreamCode === "string" ? payload.upstreamCode : undefined });
      throw error;
    }
  }
}
