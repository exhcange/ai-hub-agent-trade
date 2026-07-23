import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";
import { strictObject } from "./validation.js";

export const accountTools: ToolSpec[] = [
  {
    name: "spot_get_account",
    title: "Get Spot Account",
    description: "Get the signed account overview for the configured profile.",
    cliPath: ["account", "get"],
    module: "spot-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", additionalProperties: false },
    errorCodes: ["AI_HUB_CREDENTIAL_NOT_CONFIGURED", "AI_HUB_OPENAPI_NETWORK_ERROR", "AI_HUB_OPENAPI_HTTP_ERROR", "AI_HUB_OPENAPI_INVALID_RESPONSE", "AI_HUB_OPENAPI_BUSINESS_ERROR"],
    validate: (input) => strictObject(input, []),
    handler: async (_input, context) => {
      if (!context.credentials) throw new AiHubError("AI_HUB_CREDENTIAL_NOT_CONFIGURED", `Credentials are not configured for profile "${context.profile.name}".`);
      return context.api.account(context.credentials);
    }
  }
];
