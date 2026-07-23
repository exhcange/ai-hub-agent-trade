import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";
import { optionalPositiveInteger, positiveDecimal, signed, signedReadErrors, writeErrors } from "./tool-utils.js";
import { optionalString, requiredString, strictObject } from "./validation.js";

const accountTypes = ["1", "2", "3", "4", "5"] as const;

function accountType(value: Record<string, unknown>, name: string): string {
  const result = requiredString(value, name);
  if (!accountTypes.includes(result as typeof accountTypes[number])) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} must be an account type from 1 to 5.`);
  return result;
}

function requiredTransfer(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["fromAccountType", "toAccountType", "symbol", "coinSymbol", "amount"]);
  return { fromAccountType: accountType(value, "fromAccountType"), toAccountType: accountType(value, "toAccountType"), coinSymbol: requiredString(value, "coinSymbol"), amount: positiveDecimal(value, "amount"), ...(optionalString(value, "symbol") ? { symbol: optionalString(value, "symbol") } : {}) };
}

function transferQuery(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["fromAccountType", "toAccountType", "symbol", "coinSymbol", "page", "pageSize"]);
  return { fromAccountType: accountType(value, "fromAccountType"), toAccountType: accountType(value, "toAccountType"), page: optionalPositiveInteger(value, "page", 1), pageSize: optionalPositiveInteger(value, "pageSize", 20, 100), ...(optionalString(value, "symbol") ? { symbol: optionalString(value, "symbol") } : {}), ...(optionalString(value, "coinSymbol") ? { coinSymbol: optionalString(value, "coinSymbol") } : {}) };
}

function transferAccounts(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["coinSymbol", "amount", "fromAccount", "toAccount"]);
  return { coinSymbol: requiredString(value, "coinSymbol"), amount: positiveDecimal(value, "amount"), fromAccount: requiredString(value, "fromAccount"), toAccount: requiredString(value, "toAccount") };
}

function transferAccountHistory(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["transferId", "coinSymbol", "fromAccount", "toAccount", "startTime", "endTime", "page", "limit"]);
  const transferId = optionalString(value, "transferId");
  if (!transferId && (!optionalString(value, "fromAccount") || !optionalString(value, "toAccount"))) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "fromAccount and toAccount are required when transferId is omitted.");
  return { ...(transferId ? { transferId } : {}), ...(optionalString(value, "coinSymbol") ? { coinSymbol: optionalString(value, "coinSymbol") } : {}), ...(optionalString(value, "fromAccount") ? { fromAccount: optionalString(value, "fromAccount") } : {}), ...(optionalString(value, "toAccount") ? { toAccount: optionalString(value, "toAccount") } : {}), ...(optionalString(value, "startTime") ? { startTime: optionalString(value, "startTime") } : {}), ...(optionalString(value, "endTime") ? { endTime: optionalString(value, "endTime") } : {}), page: optionalPositiveInteger(value, "page", 1), limit: optionalPositiveInteger(value, "limit", 20, 100) };
}

function pagedDates(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["startTime", "endTime", "page", "pageSize"]);
  return { ...(optionalString(value, "startTime") ? { startTime: optionalString(value, "startTime") } : {}), ...(optionalString(value, "endTime") ? { endTime: optionalString(value, "endTime") } : {}), page: optionalPositiveInteger(value, "page", 1), pageSize: optionalPositiveInteger(value, "pageSize", 20, 100) };
}

function coinOnly(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["mainCoinSymbol"]);
  return { mainCoinSymbol: requiredString(value, "mainCoinSymbol") };
}

export const assetTools: ToolSpec<any>[] = [
  {
    name: "account_transfer", title: "Transfer Between Accounts", description: "Transfer an asset between documented account types after confirmation.", cliPath: ["account", "transfer"], module: "spot-account", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { coinSymbol: { type: "string" }, amount: { type: "string" }, fromAccount: { type: "string" }, toAccount: { type: "string" } }, required: ["coinSymbol", "amount", "fromAccount", "toAccount"], additionalProperties: false }, errorCodes: writeErrors,
    validate: transferAccounts, handler: (input, context) => context.api.signedPost("/sapi/v1/asset/transfer", input as Record<string, unknown>, signed(context)),
    writeSummary: (input) => ({ action: "account_transfer", ...(input as Record<string, unknown>) })
  },
  {
    name: "account_get_transfer_history", title: "Get Account Transfer History", description: "Query documented account transfer history.", cliPath: ["account", "transfer-history"], module: "spot-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { transferId: { type: "string" }, coinSymbol: { type: "string" }, fromAccount: { type: "string" }, toAccount: { type: "string" }, startTime: { type: "string" }, endTime: { type: "string" }, page: { type: "integer" }, limit: { type: "integer" } }, additionalProperties: false }, errorCodes: signedReadErrors,
    validate: transferAccountHistory, handler: (input, context) => context.api.signedPost("/sapi/v1/asset/transferQuery", input as Record<string, unknown>, signed(context))
  },
  {
    name: "wallet_universal_transfer", title: "Universal Asset Transfer", description: "Transfer between account types after confirmation.", cliPath: ["wallet", "transfer"], module: "spot-deposit-withdraw", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { fromAccountType: { type: "string" }, toAccountType: { type: "string" }, symbol: { type: "string" }, coinSymbol: { type: "string" }, amount: { type: "string" } }, required: ["fromAccountType", "toAccountType", "coinSymbol", "amount"], additionalProperties: false }, errorCodes: writeErrors,
    validate: requiredTransfer, handler: (input, context) => context.api.signedPost("/sapi/v1/asset/universal_transfer", input as Record<string, unknown>, signed(context)),
    writeSummary: (input) => ({ action: "universal_transfer", ...(input as Record<string, unknown>) })
  },
  {
    name: "wallet_get_universal_transfer_history", title: "Get Universal Transfer History", description: "Query universal asset transfer history.", cliPath: ["wallet", "transfer-history"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { fromAccountType: { type: "string" }, toAccountType: { type: "string" }, symbol: { type: "string" }, coinSymbol: { type: "string" }, page: { type: "integer" }, pageSize: { type: "integer" } }, required: ["fromAccountType", "toAccountType"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: transferQuery, handler: (input, context) => context.api.signedPost("/sapi/v1/asset/universal_transfer_query", input as Record<string, unknown>, signed(context))
  },
  {
    name: "wallet_get_deposit_history", title: "Get Deposit History", description: "Query deposit history.", cliPath: ["wallet", "deposit-history"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { startTime: { type: "string" }, endTime: { type: "string" }, page: { type: "integer" }, pageSize: { type: "integer" } }, additionalProperties: false }, errorCodes: signedReadErrors,
    validate: pagedDates, handler: (input, context) => context.api.signedPost("/sapi/v1/deposit/his_list", input as Record<string, unknown>, signed(context))
  },
  {
    name: "wallet_get_deposit_address", title: "Get Deposit Addresses", description: "Query deposit address list for a main coin.", cliPath: ["wallet", "deposit-address"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { mainCoinSymbol: { type: "string" } }, required: ["mainCoinSymbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: coinOnly, handler: (input, context) => context.api.signedPost("/sapi/v1/deposit/query_address", input as Record<string, unknown>, signed(context))
  },
  {
    name: "wallet_get_withdraw_address", title: "Get Withdraw Addresses", description: "Query withdraw address list for a main coin.", cliPath: ["wallet", "withdraw-address"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { mainCoinSymbol: { type: "string" }, trustType: { type: "string" }, addrType: { type: "string" } }, required: ["mainCoinSymbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["mainCoinSymbol", "trustType", "addrType"]); return { mainCoinSymbol: requiredString(value, "mainCoinSymbol"), ...(optionalString(value, "trustType") ? { trustType: optionalString(value, "trustType") } : {}), ...(optionalString(value, "addrType") ? { addrType: optionalString(value, "addrType") } : {}) }; }, handler: (input, context) => context.api.signedPost("/sapi/v1/withdraw/address/query", input as Record<string, unknown>, signed(context))
  },
  {
    name: "wallet_get_transferable_assets", title: "Get Transferable Assets", description: "Query assets transferable from one account type.", cliPath: ["wallet", "transferable-assets"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { accountType: { type: "string" } }, required: ["accountType"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["accountType"]); return { accountType: accountType(value, "accountType") }; }, handler: (input, context) => context.api.signedPost("/sapi/v1/asset/account/by_type", input as Record<string, unknown>, signed(context))
  },
  {
    name: "wallet_get_exchange_account", title: "Get Exchange Account Assets", description: "Query exchange account assets.", cliPath: ["wallet", "exchange-account"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { strictObject(input, []); return {}; }, handler: (_input, context) => context.api.signedPost("/sapi/v1/asset/exchange/account", {}, signed(context))
  },
  {
    name: "wallet_create_withdraw", title: "Create Withdrawal", description: "Submit a withdrawal request after confirmation.", cliPath: ["wallet", "withdraw"], module: "spot-deposit-withdraw", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { withdrawOrderId: { type: "string" }, symbol: { type: "string" }, amount: { type: "string" }, address: { type: "string" }, label: { type: "string" } }, required: ["withdrawOrderId", "symbol", "amount", "address"], additionalProperties: false }, errorCodes: writeErrors,
    validate: (input) => { const value = strictObject(input, ["withdrawOrderId", "symbol", "amount", "address", "label"]); return { withdrawOrderId: requiredString(value, "withdrawOrderId"), symbol: requiredString(value, "symbol"), amount: positiveDecimal(value, "amount"), address: requiredString(value, "address"), ...(optionalString(value, "label") ? { label: optionalString(value, "label") } : {}) }; }, handler: (input, context) => context.api.signedPost("/sapi/v1/withdraw/apply", input as Record<string, unknown>, signed(context)),
    writeSummary: (input) => { const value = input as Record<string, unknown>; return { action: "create_withdraw", withdrawOrderId: value.withdrawOrderId, symbol: value.symbol, amount: value.amount, address: value.address, label: value.label ?? null }; }
  },
  {
    name: "wallet_get_withdraw_history", title: "Get Withdrawal History", description: "Query withdrawal request history.", cliPath: ["wallet", "withdraw-history"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { withdrawId: { type: "string" }, withdrawOrderId: { type: "string" }, symbol: { type: "string" }, startTime: { type: "string" }, endTime: { type: "string" }, page: { type: "integer" } }, additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["withdrawId", "withdrawOrderId", "symbol", "startTime", "endTime", "page"]); return { ...(optionalString(value, "withdrawId") ? { withdrawId: optionalString(value, "withdrawId") } : {}), ...(optionalString(value, "withdrawOrderId") ? { withdrawOrderId: optionalString(value, "withdrawOrderId") } : {}), ...(optionalString(value, "symbol") ? { symbol: optionalString(value, "symbol") } : {}), ...(optionalString(value, "startTime") ? { startTime: optionalString(value, "startTime") } : {}), ...(optionalString(value, "endTime") ? { endTime: optionalString(value, "endTime") } : {}), page: optionalPositiveInteger(value, "page", 1) }; }, handler: (input, context) => context.api.signedPost("/sapi/v1/withdraw/query", input as Record<string, unknown>, signed(context))
  }
];
