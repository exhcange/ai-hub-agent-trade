import { AiHubError } from "../errors.js";
import { findAssetBalance } from "./account-balance.js";
import type { ToolSpec } from "./tool-spec.js";
import { requiredString, strictObject } from "./validation.js";

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
  },
  {
    name: "account_get_asset_balance",
    title: "Get Asset Balance",
    description: "Get one asset's available, frozen, and total spot balance. Use this instead of the full account overview when the user asks about one asset.",
    cliPath: ["account", "asset-balance"],
    module: "spot-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { asset: { type: "string", minLength: 1, description: "Asset code, for example ETH or USDT." } }, required: ["asset"], additionalProperties: false },
    errorCodes: ["AI_HUB_INVALID_ARGUMENT", "AI_HUB_CREDENTIAL_NOT_CONFIGURED", "AI_HUB_OPENAPI_NETWORK_ERROR", "AI_HUB_OPENAPI_HTTP_ERROR", "AI_HUB_OPENAPI_INVALID_RESPONSE", "AI_HUB_OPENAPI_BUSINESS_ERROR"],
    validate: (input) => {
      const value = strictObject(input, ["asset"]);
      return { asset: requiredString(value, "asset").toUpperCase() };
    },
    handler: async (input, context) => {
      if (!context.credentials) throw new AiHubError("AI_HUB_CREDENTIAL_NOT_CONFIGURED", `Credentials are not configured for profile "${context.profile.name}".`);
      return findAssetBalance(await context.api.account(context.credentials), (input as { asset: string }).asset);
    }
  }
];
