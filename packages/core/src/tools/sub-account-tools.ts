import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";
import { optionalPositiveInteger, positiveDecimal, signed, signedReadErrors, writeErrors } from "./tool-utils.js";
import { optionalString, requiredString, strictObject } from "./validation.js";

function fields(input: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  const value = strictObject(input, allowed);
  const result: Record<string, unknown> = {};
  for (const name of required) result[name] = requiredString(value, name);
  for (const name of allowed) if (!required.includes(name) && optionalString(value, name)) result[name] = optionalString(value, name);
  return result;
}

function pages(value: Record<string, unknown>): Record<string, unknown> {
  return { page: optionalPositiveInteger(value, "page", 1), pageSize: optionalPositiveInteger(value, "pageSize", 20, 100) };
}

function transfer(value: Record<string, unknown>, requireSubUid: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = { coinSymbol: requiredString(value, "coinSymbol"), amount: positiveDecimal(value, "amount") };
  if (requireSubUid) result.subUid = requiredString(value, "subUid");
  return result;
}

export const subAccountTools: ToolSpec<any>[] = [
  {
    name: "sub_account_list", title: "List Sub-accounts", description: "Get enabled sub-accounts under the main account.", cliPath: ["sub-account", "list"], module: "spot-sub-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", additionalProperties: false }, errorCodes: signedReadErrors, validate: (input) => { strictObject(input, []); return {}; }, handler: (_input, context) => context.api.signedPost("/sapi/v1/sub_user/get_sub_user_List", {}, signed(context))
  },
  {
    name: "sub_account_create", title: "Create Sub-account", description: "Create a virtual sub-account after confirmation.", cliPath: ["sub-account", "create"], module: "spot-sub-account", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { subUserEmail: { type: "string", maxLength: 5 } }, required: ["subUserEmail"], additionalProperties: false }, errorCodes: writeErrors,
    validate: (input) => { const value = fields(input, ["subUserEmail"], ["subUserEmail"]); if (String(value.subUserEmail).length > 5) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "subUserEmail must be at most 5 characters."); return value; }, handler: (input, context) => context.api.signedPost("/sapi/v1/sub_user/create_sub_user", input as Record<string, unknown>, signed(context)), writeSummary: (input) => ({ action: "create_sub_account", subUserEmail: (input as Record<string, unknown>).subUserEmail })
  },
  {
    name: "sub_account_update_trading_status", title: "Update Sub-account Trading Status", description: "Enable or disable a sub-account capability after confirmation.", cliPath: ["sub-account", "set-trading-status"], module: "spot-sub-account", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { subUid: { type: "string" }, type: { type: "string", enum: ["lever", "etf", "deposit"] }, status: { type: "string", enum: ["0", "1"] } }, required: ["subUid", "type", "status"], additionalProperties: false }, errorCodes: writeErrors,
    validate: (input) => { const value = fields(input, ["subUid", "type", "status"], ["subUid", "type", "status"]); if (!["lever", "etf", "deposit"].includes(String(value.type)) || !["0", "1"].includes(String(value.status))) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "type or status is invalid."); return value; }, handler: (input, context) => context.api.signedPost("/sapi/v1/sub_user/update_trade_status", input as Record<string, unknown>, signed(context)), writeSummary: (input) => ({ action: "update_sub_account_trading_status", ...(input as Record<string, unknown>) })
  },
  {
    name: "sub_account_get_api_key_ips", title: "Get Sub-account API Key IPs", description: "Get a sub-account API key whitelist.", cliPath: ["sub-account", "api-key", "list"], module: "spot-sub-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { subUid: { type: "string" } }, required: ["subUid"], additionalProperties: false }, errorCodes: signedReadErrors, validate: (input) => fields(input, ["subUid"], ["subUid"]), handler: (input, context) => context.api.signedPost("/sapi/v1/sub_user/sub_account_api/list", input as Record<string, unknown>, signed(context))
  },
  {
    name: "sub_account_update_api_key_ips", title: "Update Sub-account API Key IPs", description: "Update a sub-account API key IP whitelist after confirmation.", cliPath: ["sub-account", "api-key", "set-ip"], module: "spot-sub-account", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { subUid: { type: "string" }, subAccountApiKey: { type: "string" }, status: { type: "string", enum: ["1", "2"] }, ipAddress: { type: "string" } }, required: ["subUid", "subAccountApiKey", "status"], additionalProperties: false }, errorCodes: writeErrors,
    validate: (input) => { const value = fields(input, ["subUid", "subAccountApiKey", "status", "ipAddress"], ["subUid", "subAccountApiKey", "status"]); if (!["1", "2"].includes(String(value.status))) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "status must be 1 or 2."); if (value.status === "2" && !value.ipAddress) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "ipAddress is required when status is 2."); return value; }, handler: (input, context) => context.api.signedPost("/sapi/v1/sub_user/sub_account_api/update_ip", input as Record<string, unknown>, signed(context)), writeSummary: (input) => ({ action: "update_sub_account_api_key_ips", ...(input as Record<string, unknown>) })
  },
  {
    name: "sub_account_delete_api_key", title: "Delete Sub-account API Key", description: "Delete a sub-account API key after confirmation.", cliPath: ["sub-account", "api-key", "delete"], module: "spot-sub-account", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { subUid: { type: "string" }, subAccountApiKey: { type: "string" } }, required: ["subUid", "subAccountApiKey"], additionalProperties: false }, errorCodes: writeErrors,
    validate: (input) => fields(input, ["subUid", "subAccountApiKey"], ["subUid", "subAccountApiKey"]), handler: (input, context) => context.api.signedPost("/sapi/v1/sub_user/sub_account_api/delete", input as Record<string, unknown>, signed(context)), writeSummary: (input) => ({ action: "delete_sub_account_api_key", ...(input as Record<string, unknown>) })
  },
  {
    name: "sub_account_get_assets", title: "Get Sub-account Assets", description: "Query sub-account assets by account type.", cliPath: ["sub-account", "assets"], module: "spot-sub-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { subUid: { type: "string" }, accountType: { type: "string" }, type: { type: "string" } }, required: ["subUid", "accountType"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => fields(input, ["subUid", "accountType", "type"], ["subUid", "accountType"]), handler: (input, context) => context.api.signedPost("/sapi/v1/sub_user/asset/account", input as Record<string, unknown>, signed(context))
  },
  {
    name: "sub_account_root_transfer", title: "Transfer Between Root and Sub-account", description: "Transfer assets between a root and sub-account after confirmation.", cliPath: ["sub-account", "root-transfer"], module: "spot-sub-account", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { subUid: { type: "string" }, coinSymbol: { type: "string" }, amount: { type: "string" }, type: { type: "string" } }, required: ["subUid", "coinSymbol", "amount", "type"], additionalProperties: false }, errorCodes: writeErrors,
    validate: (input) => { const value = strictObject(input, ["subUid", "coinSymbol", "amount", "type"]); return { ...transfer(value, true), type: requiredString(value, "type") }; }, handler: (input, context) => context.api.signedPost("/sapi/v1/sub_user/asset/root_transfer", input as Record<string, unknown>, signed(context)), writeSummary: (input) => ({ action: "sub_account_root_transfer", ...(input as Record<string, unknown>) })
  },
  {
    name: "sub_account_get_root_transfer_history", title: "Get Root/Sub Transfer History", description: "Query root and sub-account transfer history.", cliPath: ["sub-account", "root-transfer-history"], module: "spot-sub-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { subUid: { type: "string" }, coinSymbol: { type: "string" }, page: { type: "integer" }, pageSize: { type: "integer" } }, required: ["subUid", "coinSymbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["subUid", "coinSymbol", "page", "pageSize"]); return { subUid: requiredString(value, "subUid"), coinSymbol: requiredString(value, "coinSymbol"), ...pages(value) }; }, handler: (input, context) => context.api.signedPost("/sapi/v1/sub_user/asset/root_transfer_query", input as Record<string, unknown>, signed(context))
  },
  {
    name: "sub_account_internal_transfer", title: "Transfer Within Sub-account", description: "Transfer assets between a sub-account's internal account types after confirmation.", cliPath: ["sub-account", "internal-transfer"], module: "spot-sub-account", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { subUid: { type: "string" }, coinSymbol: { type: "string" }, amount: { type: "string" }, type: { type: "string" }, accountType: { type: "string" }, symbol: { type: "string" } }, required: ["subUid", "coinSymbol", "amount", "type", "accountType"], additionalProperties: false }, errorCodes: writeErrors,
    validate: (input) => { const value = strictObject(input, ["subUid", "coinSymbol", "amount", "type", "accountType", "symbol"]); return { ...transfer(value, true), type: requiredString(value, "type"), accountType: requiredString(value, "accountType"), ...(optionalString(value, "symbol") ? { symbol: optionalString(value, "symbol") } : {}) }; }, handler: (input, context) => context.api.signedPost("/sapi/v1/sub_user/asset/transfer", input as Record<string, unknown>, signed(context)), writeSummary: (input) => ({ action: "sub_account_internal_transfer", ...(input as Record<string, unknown>) })
  },
  {
    name: "sub_account_get_internal_transfer_history", title: "Get Sub-account Internal Transfer History", description: "Query internal sub-account transfer history.", cliPath: ["sub-account", "internal-transfer-history"], module: "spot-sub-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { subUid: { type: "string" }, type: { type: "string" }, accountType: { type: "string" }, coinSymbol: { type: "string" }, page: { type: "integer" }, pageSize: { type: "integer" } }, required: ["subUid", "type", "accountType", "coinSymbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["subUid", "type", "accountType", "coinSymbol", "page", "pageSize"]); return { subUid: requiredString(value, "subUid"), type: requiredString(value, "type"), accountType: requiredString(value, "accountType"), coinSymbol: requiredString(value, "coinSymbol"), ...pages(value) }; }, handler: (input, context) => context.api.signedPost("/sapi/v1/sub_user/asset/transfer_query", input as Record<string, unknown>, signed(context))
  },
  {
    name: "sub_account_transfer_to_parent", title: "Transfer From Sub-account to Parent", description: "Transfer assets to the parent account after confirmation.", cliPath: ["sub-account", "transfer-to-parent"], module: "spot-sub-account", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { coinSymbol: { type: "string" }, amount: { type: "string" } }, required: ["coinSymbol", "amount"], additionalProperties: false }, errorCodes: writeErrors,
    validate: (input) => { const value = strictObject(input, ["coinSymbol", "amount"]); return transfer(value, false); }, handler: (input, context) => context.api.signedPost("/sapi/v1/asset/subaccount/transfer", input as Record<string, unknown>, signed(context)), writeSummary: (input) => ({ action: "sub_account_transfer_to_parent", ...(input as Record<string, unknown>) })
  },
  {
    name: "sub_account_get_parent_transfer_history", title: "Get Parent Transfer History", description: "Query transfers between this sub-account and its parent.", cliPath: ["sub-account", "parent-transfer-history"], module: "spot-sub-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { coinSymbol: { type: "string" }, page: { type: "integer" }, pageSize: { type: "integer" } }, required: ["coinSymbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["coinSymbol", "page", "pageSize"]); return { coinSymbol: requiredString(value, "coinSymbol"), ...pages(value) }; }, handler: (input, context) => context.api.signedPost("/sapi/v1/asset/subaccount/transfer_query", input as Record<string, unknown>, signed(context))
  }
];
