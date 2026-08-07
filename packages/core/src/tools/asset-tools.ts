import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";
import { optionalPositiveInteger, positiveDecimal, signed, signedReadErrors, writeErrors } from "./tool-utils.js";
import { optionalString, requiredString, strictObject } from "./validation.js";
import { STANDARD_PAGE_SIZE, listLimitSchema, normalizedListLimit } from "./list-limit.js";
import { resolveTenantAsset, resolveTenantSymbol } from "./symbol-rules.js";

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
  return { fromAccountType, toAccountType, page: optionalPositiveInteger(value, "page", 1), pageSize: normalizedListLimit(value, STANDARD_PAGE_SIZE), ...(symbol ? { symbol } : {}), ...(optionalString(value, "coinSymbol") ? { coinSymbol: optionalString(value, "coinSymbol") } : {}) };
}

function withAccountTypeMetadata(response: unknown, value: string): Record<string, unknown> {
  const metadata = { accountType: value, accountTypeName: accountTypeName(value) };
  if (response && typeof response === "object" && !Array.isArray(response)) return { ...(response as Record<string, unknown>), ...metadata };
  return { ...metadata, response };
}

function pagedDates(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["startTime", "endTime", "page", "pageSize"]);
  return { ...(optionalString(value, "startTime") ? { startTime: optionalString(value, "startTime") } : {}), ...(optionalString(value, "endTime") ? { endTime: optionalString(value, "endTime") } : {}), page: optionalPositiveInteger(value, "page", 1), pageSize: normalizedListLimit(value, STANDARD_PAGE_SIZE) };
}

function coinOnly(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["mainCoinSymbol"]);
  return { mainCoinSymbol: requiredString(value, "mainCoinSymbol") };
}

/** Converts only documented OpenAPI identifier fields; never guesses nested data. */
async function resolveTenantIdentifiers(
  input: Record<string, unknown>,
  context: Parameters<ToolSpec["handler"]>[1],
  symbolKind: "pair" | "asset" = "pair",
  assetResolutionMode: "read" | "write" = "read"
): Promise<Record<string, unknown>> {
  return {
    ...input,
    ...(typeof input.symbol === "string" ? { symbol: symbolKind === "asset" ? await resolveTenantAsset(context, input.symbol, assetResolutionMode) : await resolveTenantSymbol(context, input.symbol) } : {}),
    ...(typeof input.coinSymbol === "string" ? { coinSymbol: await resolveTenantAsset(context, input.coinSymbol, assetResolutionMode) } : {}),
    ...(typeof input.mainCoinSymbol === "string" ? { mainCoinSymbol: await resolveTenantAsset(context, input.mainCoinSymbol, assetResolutionMode) } : {})
  };
}

/**
 * Keeps the user-facing asset only in the confirmation payload so the preview
 * can explain a mixed-cloud transfer as `USDT` -> `USDT1701`. The API handler
 * strips the local field before signing/sending the request.
 */
async function resolveUniversalTransfer(input: Record<string, unknown>, context: Parameters<ToolSpec["handler"]>[1]): Promise<Record<string, unknown>> {
  return {
    ...(await resolveTenantIdentifiers(input, context, "pair", "write")),
    displayCoinSymbol: input.coinSymbol
  };
}

function universalTransferBody(input: Record<string, unknown>): Record<string, unknown> {
  const { displayCoinSymbol: _displayCoinSymbol, ...body } = input;
  return body;
}

export const assetTools: ToolSpec<any>[] = [
  {
    name: "wallet_universal_transfer", title: "Universal Asset Transfer", description: "Transfer between numeric account types after confirmation: 1=Spot, 2=Isolated Margin, 3=Cross Margin, 4=C2C, 5=Derivatives. Account type 2 is not Derivatives and requires symbol.", cliPath: ["wallet", "transfer"], module: "spot-deposit-withdraw", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { fromAccountType: accountTypeSchema, toAccountType: accountTypeSchema, symbol: { type: "string", description: "Required isolated-margin trading pair when either account type is 2, for example ETHUSDT. Not a Derivatives identifier." }, coinSymbol: { type: "string" }, amount: { type: "string" } }, required: ["fromAccountType", "toAccountType", "coinSymbol", "amount"], additionalProperties: false }, errorCodes: writeErrors,
    validate: requiredTransfer,
    preflight: (input, context) => resolveUniversalTransfer(input as Record<string, unknown>, context),
    handler: (input, context) => context.api.signedPost("/sapi/v1/asset/universal_transfer", universalTransferBody(input as Record<string, unknown>), signed(context)),
    writeSummary: (input) => {
      const value = input as Record<string, unknown>;
      const displayCoinSymbol = String(value.displayCoinSymbol ?? value.coinSymbol);
      const apiCoinSymbol = String(value.coinSymbol);
      return {
        action: "universal_transfer",
        fromAccountType: value.fromAccountType,
        fromAccountTypeName: accountTypeName(String(value.fromAccountType)),
        toAccountType: value.toAccountType,
        toAccountTypeName: accountTypeName(String(value.toAccountType)),
        coinSymbol: displayCoinSymbol,
        apiCoinSymbol,
        amount: value.amount,
        symbol: value.symbol ?? null,
        apiSymbol: value.symbol ?? null,
        quantityOrAmount: { value: value.amount, asset: displayCoinSymbol, apiAsset: apiCoinSymbol, meaning: "exact asset amount to transfer" },
        estimatedNotional: { amount: null, status: "not_applicable", explanation: "A transfer changes account location, not its asset value." }
      };
    }
  },
  {
    name: "wallet_get_universal_transfer_history", title: "Get Universal Transfer History", description: "Query universal transfer history using account types 1=Spot, 2=Isolated Margin, 3=Cross Margin, 4=C2C, and 5=Derivatives.", cliPath: ["wallet", "transfer-history"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { fromAccountType: accountTypeSchema, toAccountType: accountTypeSchema, symbol: { type: "string", description: "Isolated-margin trading pair when account type 2 is involved." }, coinSymbol: { type: "string" }, page: { type: "integer", minimum: 1 }, pageSize: listLimitSchema(STANDARD_PAGE_SIZE) }, required: ["fromAccountType", "toAccountType"], additionalProperties: false }, errorCodes: signedReadErrors,
    listLimit: STANDARD_PAGE_SIZE,
    validate: transferQuery, handler: async (input, context) => context.api.signedPost("/sapi/v1/asset/universal_transfer_query", await resolveTenantIdentifiers(input as Record<string, unknown>, context), signed(context))
  },
  {
    name: "wallet_get_deposit_history", title: "Get Deposit History", description: "Query deposit history.", cliPath: ["wallet", "deposit-history"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { startTime: { type: "string" }, endTime: { type: "string" }, page: { type: "integer", minimum: 1 }, pageSize: listLimitSchema(STANDARD_PAGE_SIZE) }, additionalProperties: false }, errorCodes: signedReadErrors,
    listLimit: STANDARD_PAGE_SIZE,
    validate: pagedDates, handler: (input, context) => context.api.signedPost("/sapi/v1/deposit/his_list", input as Record<string, unknown>, signed(context))
  },
  {
    name: "wallet_get_deposit_address", title: "Get Deposit Addresses", description: "Query deposit address list for a main coin.", cliPath: ["wallet", "deposit-address"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { mainCoinSymbol: { type: "string" } }, required: ["mainCoinSymbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    unpagedListLimit: { path: ["data", "depositAddrList"] },
    validate: coinOnly, handler: async (input, context) => context.api.signedPost("/sapi/v1/deposit/query_address", await resolveTenantIdentifiers(input as Record<string, unknown>, context), signed(context))
  },
  {
    name: "wallet_get_withdraw_address", title: "Get Withdraw Addresses", description: "Query withdraw address list for a main coin.", cliPath: ["wallet", "withdraw-address"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { mainCoinSymbol: { type: "string" }, trustType: { type: "string" }, addrType: { type: "string" } }, required: ["mainCoinSymbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    unpagedListLimit: { path: ["data", "addressList"] },
    validate: (input) => { const value = strictObject(input, ["mainCoinSymbol", "trustType", "addrType"]); return { mainCoinSymbol: requiredString(value, "mainCoinSymbol"), ...(optionalString(value, "trustType") ? { trustType: optionalString(value, "trustType") } : {}), ...(optionalString(value, "addrType") ? { addrType: optionalString(value, "addrType") } : {}) }; }, handler: async (input, context) => context.api.signedPost("/sapi/v1/withdraw/address/query", await resolveTenantIdentifiers(input as Record<string, unknown>, context), signed(context))
  },
  {
    name: "wallet_get_transferable_assets", title: "Get Transferable Assets", description: "Query transferable assets for one account type. The response echoes the selected account type and its name: 1=Spot, 2=Isolated Margin, 3=Cross Margin, 4=C2C, 5=Derivatives.", cliPath: ["wallet", "transferable-assets"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { accountType: accountTypeSchema }, required: ["accountType"], additionalProperties: false }, errorCodes: signedReadErrors,
    unpagedListLimit: { path: ["data", "accountList"] },
    validate: (input) => { const value = strictObject(input, ["accountType"]); return { accountType: accountType(value, "accountType") }; }, handler: async (input, context) => { const value = input as { accountType: string }; return withAccountTypeMetadata(await context.api.signedPost("/sapi/v1/asset/account/by_type", value, signed(context)), value.accountType); }
  },
  {
    name: "wallet_create_withdraw", title: "Create Withdrawal", description: "Submit a withdrawal request after confirmation.", cliPath: ["wallet", "withdraw"], module: "spot-deposit-withdraw", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { withdrawOrderId: { type: "string" }, symbol: { type: "string" }, amount: { type: "string" }, address: { type: "string" }, label: { type: "string" } }, required: ["withdrawOrderId", "symbol", "amount", "address"], additionalProperties: false }, errorCodes: writeErrors,
    validate: (input) => { const value = strictObject(input, ["withdrawOrderId", "symbol", "amount", "address", "label"]); return { withdrawOrderId: requiredString(value, "withdrawOrderId"), symbol: requiredString(value, "symbol"), amount: positiveDecimal(value, "amount"), address: requiredString(value, "address"), ...(optionalString(value, "label") ? { label: optionalString(value, "label") } : {}) }; },
    preflight: (input, context) => resolveTenantIdentifiers(input as Record<string, unknown>, context, "asset", "write"),
    handler: (input, context) => context.api.signedPost("/sapi/v1/withdraw/apply", input as Record<string, unknown>, signed(context)),
    writeSummary: (input) => { const value = input as Record<string, unknown>; return { action: "create_withdraw", withdrawOrderId: value.withdrawOrderId, symbol: value.symbol, amount: value.amount, address: value.address, label: value.label ?? null }; }
  },
  {
    name: "wallet_get_withdraw_history", title: "Get Withdrawal History", description: "Query withdrawal request history.", cliPath: ["wallet", "withdraw-history"], module: "spot-deposit-withdraw", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { withdrawId: { type: "string" }, withdrawOrderId: { type: "string" }, symbol: { type: "string" }, startTime: { type: "string" }, endTime: { type: "string" }, page: { type: "integer" } }, additionalProperties: false }, errorCodes: signedReadErrors,
    unpagedListLimit: { path: ["data", "withdrawList"], pageField: "page" },
    validate: (input) => { const value = strictObject(input, ["withdrawId", "withdrawOrderId", "symbol", "startTime", "endTime", "page"]); return { ...(optionalString(value, "withdrawId") ? { withdrawId: optionalString(value, "withdrawId") } : {}), ...(optionalString(value, "withdrawOrderId") ? { withdrawOrderId: optionalString(value, "withdrawOrderId") } : {}), ...(optionalString(value, "symbol") ? { symbol: optionalString(value, "symbol") } : {}), ...(optionalString(value, "startTime") ? { startTime: optionalString(value, "startTime") } : {}), ...(optionalString(value, "endTime") ? { endTime: optionalString(value, "endTime") } : {}), page: optionalPositiveInteger(value, "page", 1) }; }, handler: async (input, context) => context.api.signedPost("/sapi/v1/withdraw/query", await resolveTenantIdentifiers(input as Record<string, unknown>, context, "asset"), signed(context))
  }
];
