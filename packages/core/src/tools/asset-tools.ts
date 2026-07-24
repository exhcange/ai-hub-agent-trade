import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";
import { optionalPositiveInteger, positiveDecimal, signed, signedReadErrors, writeErrors } from "./tool-utils.js";
import { optionalString, requiredString, strictObject } from "./validation.js";

const ACCOUNT_TYPES = ["1", "2", "3", "4", "5"] as const;
const ACCOUNT_TYPE_NAMES: Readonly<Record<(typeof ACCOUNT_TYPES)[number], string>> = {
  "1": "Spot",
  "2": "Isolated Margin",
  "3": "Cross Margin",
  "4": "C2C",
  "5": "Derivatives"
};
const accountTypeSchema = {
  type: "string",
  oneOf: [
    { const: "1", title: "Spot (1)" },
    { const: "2", title: "Isolated Margin (2; symbol required)" },
    { const: "3", title: "Cross Margin (3)" },
    { const: "4", title: "C2C (4)" },
    { const: "5", title: "Derivatives (5)" }
  ],
  description: "Account type: 1=Spot, 2=Isolated Margin (requires symbol), 3=Cross Margin, 4=C2C, 5=Derivatives. Do not use 2 for Derivatives."
};
const spotDerivativeAccounts = ["EXCHANGE", "FUTURE"] as const;

function accountType(value: Record<string, unknown>, name: string): string {
  const result = requiredString(value, name);
  if (!ACCOUNT_TYPES.includes(result as typeof ACCOUNT_TYPES[number])) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} must be an account type: 1=Spot, 2=Isolated Margin, 3=Cross Margin, 4=C2C, or 5=Derivatives.`);
  return result;
}

function accountTypeName(value: string): string {
  return ACCOUNT_TYPE_NAMES[value as keyof typeof ACCOUNT_TYPE_NAMES];
}

function isIsolatedMarginTransfer(fromAccountType: string, toAccountType: string): boolean {
  return fromAccountType === "2" || toAccountType === "2";
}

function requiredTransfer(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["fromAccountType", "toAccountType", "symbol", "coinSymbol", "amount"]);
  const fromAccountType = accountType(value, "fromAccountType");
  const toAccountType = accountType(value, "toAccountType");
  if (fromAccountType === toAccountType) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "fromAccountType and toAccountType must be different.");
  const symbol = optionalString(value, "symbol");
  if (isIsolatedMarginTransfer(fromAccountType, toAccountType) && !symbol) {
    throw new AiHubError("AI_HUB_ISOLATED_MARGIN_SYMBOL_REQUIRED", "symbol is required when fromAccountType or toAccountType is 2 (Isolated Margin). Provide the isolated-margin trading pair, for example ETHUSDT.");
  }
  return { fromAccountType, toAccountType, coinSymbol: requiredString(value, "coinSymbol"), amount: positiveDecimal(value, "amount"), ...(symbol ? { symbol } : {}) };
}

function transferQuery(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["fromAccountType", "toAccountType", "symbol", "coinSymbol", "page", "pageSize"]);
  const fromAccountType = accountType(value, "fromAccountType");
  const toAccountType = accountType(value, "toAccountType");
  const symbol = optionalString(value, "symbol");
  if (isIsolatedMarginTransfer(fromAccountType, toAccountType) && !symbol) {
    throw new AiHubError("AI_HUB_ISOLATED_MARGIN_SYMBOL_REQUIRED", "symbol is required when fromAccountType or toAccountType is 2 (Isolated Margin). Provide the isolated-margin trading pair, for example ETHUSDT.");
  }
  return { fromAccountType, toAccountType, page: optionalPositiveInteger(value, "page", 1), pageSize: optionalPositiveInteger(value, "pageSize", 20, 100), ...(symbol ? { symbol } : {}), ...(optionalString(value, "coinSymbol") ? { coinSymbol: optionalString(value, "coinSymbol") } : {}) };
}

function transferAccounts(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["coinSymbol", "amount", "fromAccount", "toAccount"]);
  const fromAccount = requiredString(value, "fromAccount").toUpperCase();
  const toAccount = requiredString(value, "toAccount").toUpperCase();
  if (!spotDerivativeAccounts.includes(fromAccount as typeof spotDerivativeAccounts[number]) || !spotDerivativeAccounts.includes(toAccount as typeof spotDerivativeAccounts[number]) || fromAccount === toAccount) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "account transfer supports only EXCHANGE -> FUTURE or FUTURE -> EXCHANGE. Use wallet transfer for isolated margin, cross margin, or C2C.");
  }
  return { coinSymbol: requiredString(value, "coinSymbol"), amount: positiveDecimal(value, "amount"), fromAccount, toAccount };
}

function transferAccountHistory(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["transferId", "coinSymbol", "fromAccount", "toAccount", "startTime", "endTime", "page", "limit"]);
  const transferId = optionalString(value, "transferId");
  if (!transferId && (!optionalString(value, "fromAccount") || !optionalString(value, "toAccount"))) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "fromAccount and toAccount are required when transferId is omitted.");
  const fromAccount = optionalString(value, "fromAccount")?.toUpperCase();
  const toAccount = optionalString(value, "toAccount")?.toUpperCase();
  if (!transferId && (!spotDerivativeAccounts.includes(fromAccount as typeof spotDerivativeAccounts[number]) || !spotDerivativeAccounts.includes(toAccount as typeof spotDerivativeAccounts[number]) || fromAccount === toAccount)) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "account transfer history supports only EXCHANGE -> FUTURE or FUTURE -> EXCHANGE when transferId is omitted.");
  }
  return { ...(transferId ? { transferId } : {}), ...(optionalString(value, "coinSymbol") ? { coinSymbol: optionalString(value, "coinSymbol") } : {}), ...(fromAccount ? { fromAccount } : {}), ...(toAccount ? { toAccount } : {}), ...(optionalString(value, "startTime") ? { startTime: optionalString(value, "startTime") } : {}), ...(optionalString(value, "endTime") ? { endTime: optionalString(value, "endTime") } : {}), page: optionalPositiveInteger(value, "page", 1), limit: optionalPositiveInteger(value, "limit", 20, 100) };
}

function withAccountTypeMetadata(response: unknown, value: string): Record<string, unknown> {
  const metadata = { accountType: value, accountTypeName: accountTypeName(value) };
  if (response && typeof response === "object" && !Array.isArray(response)) return { ...(response as Record<string, unknown>), ...metadata };
  return { ...metadata, response };
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
    name: "account_transfer", title: "Transfer Between Spot and Derivatives", description: "Transfer only between Spot and Derivatives after confirmation. Use fromAccount=EXCHANGE and toAccount=FUTURE for Spot to Derivatives; use the reverse for Derivatives to Spot. Do not pass numeric account types to this Tool.", cliPath: ["account", "transfer"], module: "spot-account", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { coinSymbol: { type: "string" }, amount: { type: "string" }, fromAccount: { type: "string", enum: spotDerivativeAccounts, description: "EXCHANGE means Spot; FUTURE means Derivatives." }, toAccount: { type: "string", enum: spotDerivativeAccounts, description: "EXCHANGE means Spot; FUTURE means Derivatives." } }, required: ["coinSymbol", "amount", "fromAccount", "toAccount"], additionalProperties: false }, errorCodes: writeErrors,
    validate: transferAccounts, handler: (input, context) => context.api.signedPost("/sapi/v1/asset/transfer", input as Record<string, unknown>, signed(context)),
    writeSummary: (input) => { const value = input as Record<string, unknown>; return { action: "spot_derivatives_transfer", coinSymbol: value.coinSymbol, amount: value.amount, fromAccount: value.fromAccount, fromAccountName: value.fromAccount === "EXCHANGE" ? "Spot" : "Derivatives", toAccount: value.toAccount, toAccountName: value.toAccount === "EXCHANGE" ? "Spot" : "Derivatives" }; }
  },
  {
    name: "account_get_transfer_history", title: "Get Account Transfer History", description: "Query documented account transfer history.", cliPath: ["account", "transfer-history"], module: "spot-account", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { transferId: { type: "string" }, coinSymbol: { type: "string" }, fromAccount: { type: "string" }, toAccount: { type: "string" }, startTime: { type: "string" }, endTime: { type: "string" }, page: { type: "integer" }, limit: { type: "integer" } }, additionalProperties: false }, errorCodes: signedReadErrors,
    validate: transferAccountHistory, handler: (input, context) => context.api.signedPost("/sapi/v1/asset/transferQuery", input as Record<string, unknown>, signed(context))
  },
  {
    name: "wallet_universal_transfer", title: "Universal Asset Transfer", description: "Transfer between numeric account types after confirmation: 1=Spot, 2=Isolated Margin, 3=Cross Margin, 4=C2C, 5=Derivatives. Account type 2 is not Derivatives and requires symbol. For a straightforward Spot to Derivatives transfer, prefer account_transfer with EXCHANGE -> FUTURE.", cliPath: ["wallet", "transfer"], module: "spot-deposit-withdraw", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { fromAccountType: accountTypeSchema, toAccountType: accountTypeSchema, symbol: { type: "string", description: "Required isolated-margin trading pair when either account type is 2, for example ETHUSDT. Not a Derivatives identifier." }, coinSymbol: { type: "string" }, amount: { type: "string" } }, required: ["fromAccountType", "toAccountType", "coinSymbol", "amount"], additionalProperties: false }, errorCodes: writeErrors,
    validate: requiredTransfer, handler: (input, context) => context.api.signedPost("/sapi/v1/asset/universal_transfer", input as Record<string, unknown>, signed(context)),
    writeSummary: (input) => { const value = input as Record<string, unknown>; return { action: "universal_transfer", fromAccountType: value.fromAccountType, fromAccountTypeName: accountTypeName(String(value.fromAccountType)), toAccountType: value.toAccountType, toAccountTypeName: accountTypeName(String(value.toAccountType)), coinSymbol: value.coinSymbol, amount: value.amount, symbol: value.symbol ?? null }; }
  },
  {
    name: "wallet_get_universal_transfer_history", title: "Get Universal Transfer History", description: "Query universal transfer history using account types 1=Spot, 2=Isolated Margin, 3=Cross Margin, 4=C2C, and 5=Derivatives.", cliPath: ["wallet", "transfer-history"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { fromAccountType: accountTypeSchema, toAccountType: accountTypeSchema, symbol: { type: "string", description: "Isolated-margin trading pair when account type 2 is involved." }, coinSymbol: { type: "string" }, page: { type: "integer" }, pageSize: { type: "integer" } }, required: ["fromAccountType", "toAccountType"], additionalProperties: false }, errorCodes: signedReadErrors,
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
    name: "wallet_get_transferable_assets", title: "Get Transferable Assets", description: "Query transferable assets for one account type. The response echoes the selected account type and its name: 1=Spot, 2=Isolated Margin, 3=Cross Margin, 4=C2C, 5=Derivatives.", cliPath: ["wallet", "transferable-assets"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { accountType: accountTypeSchema }, required: ["accountType"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["accountType"]); return { accountType: accountType(value, "accountType") }; }, handler: async (input, context) => { const value = input as { accountType: string }; return withAccountTypeMetadata(await context.api.signedPost("/sapi/v1/asset/account/by_type", value, signed(context)), value.accountType); }
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
