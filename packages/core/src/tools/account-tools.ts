import { AiHubError } from "../errors.js";
import { findAssetBalance, listAssetBalances } from "./account-balance.js";
import { listLimitSchema, normalizedListLimit, type ListLimit } from "./list-limit.js";
import type { ToolSpec } from "./tool-spec.js";
import { optionalString, strictObject } from "./validation.js";
import { presentTenantAsset, resolveTenantAsset } from "./symbol-rules.js";

const ACCOUNT_BALANCE_LIST_LIMIT: Readonly<ListLimit> = {
  field: "limit",
  defaultValue: 50,
  maximum: 50
};

const signedReadErrors = ["AI_HUB_INVALID_ARGUMENT", "AI_HUB_CREDENTIAL_NOT_CONFIGURED", "AI_HUB_ASSET_AMBIGUOUS", "AI_HUB_OPENAPI_NETWORK_ERROR", "AI_HUB_OPENAPI_HTTP_ERROR", "AI_HUB_OPENAPI_INVALID_RESPONSE", "AI_HUB_OPENAPI_BUSINESS_ERROR"] as const;

function requiredAsset(value: Record<string, unknown>): string {
  const asset = optionalString(value, "asset")?.toUpperCase();
  if (!asset) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "asset is required.");
  return asset;
}

function optionalAssets(value: Record<string, unknown>): string[] | undefined {
  const assets = value.assets;
  if (assets === undefined) return undefined;
  if (!Array.isArray(assets) || assets.length === 0 || assets.length > 50) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "assets must contain between 1 and 50 asset codes.");
  }
  const normalized = assets.map((asset) => {
    if (typeof asset !== "string" || !asset.trim()) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "assets must contain non-empty asset codes.");
    return asset.trim().toUpperCase();
  });
  return [...new Set(normalized)];
}

function optionalNonZeroOnly(value: Record<string, unknown>): boolean {
  if (value.nonZeroOnly === undefined) return true;
  if (typeof value.nonZeroOnly !== "boolean") throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "nonZeroOnly must be a boolean.");
  return value.nonZeroOnly;
}

function requireCredentials(context: Parameters<ToolSpec["handler"]>[1]) {
  if (!context.credentials) throw new AiHubError("AI_HUB_CREDENTIAL_NOT_CONFIGURED", `Credentials are not configured for profile "${context.profile.name}".`);
  return context.credentials;
}

export const accountTools: ToolSpec[] = [
  {
    name: "account_get_asset_balance",
    title: "Get Asset Balance",
    description: "Get available, frozen, and total balance for one asset.",
    cliPath: ["account", "asset-balance"],
    module: "spot-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { asset: { type: "string", minLength: 1, description: "Asset code, for example USDT or BTC." } }, required: ["asset"], additionalProperties: false },
    errorCodes: signedReadErrors,
    validate: (input) => {
      const value = strictObject(input, ["asset"]);
      return { asset: requiredAsset(value) };
    },
    handler: async (input, context) => {
      const value = input as { asset: string };
      const apiAsset = await resolveTenantAsset(context, value.asset);
      // Use the v1 account overview for both the all-assets and one-asset
      // views. In a mixed-cloud tenant v2 can return duplicate display codes
      // (for example two BTC rows) rather than the physical BTC1701 code,
      // which makes an exact single-asset lookup unsafe.
      const balance = findAssetBalance(await context.api.accountOverview(requireCredentials(context)), apiAsset);
      return {
        ...balance,
        asset: await presentTenantAsset(context, balance.asset),
        apiAsset
      };
    }
  },
  {
    name: "account_list_balances",
    title: "List Account Balances",
    description: "List compact account balances. Defaults to non-zero assets only, up to 50.",
    cliPath: ["account", "balances"],
    module: "spot-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        assets: { type: "array", items: { type: "string" }, maxItems: 50, description: "Optional asset codes." },
        nonZeroOnly: {
          type: "boolean",
          default: true,
          description: "Omit or set true for normal balance overviews. Set false only when the user explicitly asks to include zero balances."
        },
        limit: listLimitSchema(ACCOUNT_BALANCE_LIST_LIMIT)
      },
      additionalProperties: false
    },
    errorCodes: signedReadErrors,
    listLimit: ACCOUNT_BALANCE_LIST_LIMIT,
    validate: (input) => {
      const value = strictObject(input, ["assets", "nonZeroOnly", "limit"]);
      return {
        assets: optionalAssets(value),
        nonZeroOnly: optionalNonZeroOnly(value),
        limit: normalizedListLimit(value, ACCOUNT_BALANCE_LIST_LIMIT)
      };
    },
    handler: async (input, context) => {
      const value = input as { assets?: string[]; nonZeroOnly: boolean; limit: number };
      const apiAssets = value.assets ? await Promise.all(value.assets.map((asset) => resolveTenantAsset(context, asset))) : undefined;
      const balances = listAssetBalances(await context.api.accountOverview(requireCredentials(context)), { ...value, assets: apiAssets });
      return {
        ...balances,
        balances: await Promise.all(balances.balances.map(async (balance) => ({
          ...balance,
          asset: await presentTenantAsset(context, balance.asset),
          apiAsset: balance.asset
        })))
      };
    }
  }
];
