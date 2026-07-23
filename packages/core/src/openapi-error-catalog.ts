import type { OpenApiBusinessDiagnosis } from "./errors.js";

interface ErrorDefinition {
  reason: string;
  suggestedAction: string;
  retryable?: boolean;
  writeOutcomeUnknown?: boolean;
}

const globalErrors: Readonly<Record<string, ErrorDefinition>> = {
  "-1002": { reason: "API_KEY_REQUIRED", suggestedAction: "Configure credentials for the selected profile, then retry the read request." },
  "-1003": { reason: "RATE_LIMITED", suggestedAction: "Wait before retrying. Reduce request frequency and do not retry a write automatically.", retryable: true },
  "-1006": { reason: "WRITE_STATUS_UNKNOWN", suggestedAction: "Do not retry automatically. Query the affected order or history record before taking another action.", writeOutcomeUnknown: true },
  "-1007": { reason: "UPSTREAM_TIMEOUT", suggestedAction: "For a write, query the affected order or history record before retrying. A read can be retried after a short delay.", retryable: true, writeOutcomeUnknown: true },
  "-1015": { reason: "TOO_MANY_ORDERS", suggestedAction: "Reduce the number of active or requested orders before retrying." },
  "-1020": { reason: "UNSUPPORTED_OPERATION", suggestedAction: "Use a supported command and do not substitute another operation automatically." },
  "-1021": { reason: "INVALID_TIMESTAMP", suggestedAction: "Synchronize the local system clock, then retry the request." },
  "-1022": { reason: "INVALID_SIGNATURE", suggestedAction: "Verify the selected profile credentials and signing configuration, then retry." },
  "-1023": { reason: "TIMESTAMP_REQUIRED", suggestedAction: "Use the AI Hub CLI or MCP client so the request timestamp is supplied automatically." },
  "-1024": { reason: "SIGNATURE_REQUIRED", suggestedAction: "Use the AI Hub CLI or MCP client so the request is signed automatically." },
  "-1100": { reason: "INVALID_REQUEST_CHARACTERS", suggestedAction: "Correct the invalid request value and retry." },
  "-1102": { reason: "MISSING_OR_MALFORMED_PARAMETER", suggestedAction: "Provide every required parameter in the documented format." },
  "-1103": { reason: "UNKNOWN_PARAMETER", suggestedAction: "Remove unsupported parameters and use the CLI command reference." },
  "-1111": { reason: "INVALID_PRECISION", suggestedAction: "Use the symbol's allowed price and quantity precision." },
  "-1121": { reason: "INVALID_SYMBOL", suggestedAction: "Query supported symbols and use an exact symbol value." },
  "-1136": { reason: "ORDER_QUANTITY_TOO_SMALL", suggestedAction: "Increase the order quantity to the symbol minimum." },
  "-1138": { reason: "ORDER_PRICE_OUT_OF_RANGE", suggestedAction: "Use a price inside the allowed range, then create a new preview." },
  "-1139": { reason: "MARKET_ORDER_UNSUPPORTED", suggestedAction: "Use a supported order type for the selected symbol." },
  "-1145": { reason: "ORDER_CANNOT_BE_CANCELLED", suggestedAction: "Query the latest order status before attempting another cancellation." },
  "-2013": { reason: "ORDER_NOT_FOUND", suggestedAction: "Verify the symbol and order ID, then query open orders if needed." },
  "-2014": { reason: "INVALID_API_KEY_FORMAT", suggestedAction: "Replace the configured API key with a valid value." },
  "-2015": { reason: "API_KEY_REJECTED", suggestedAction: "Verify API key permissions, IP restrictions, and the selected tenant profile." },
  "-2016": { reason: "TRADING_DISABLED", suggestedAction: "The account is restricted. Contact the platform administrator before trying again." },
  "-2017": { reason: "INSUFFICIENT_BALANCE", suggestedAction: "Check the available balance and reduce the requested amount before creating a new preview." },
  "-2018": { reason: "DUPLICATE_WITHDRAWAL_REQUEST", suggestedAction: "Use a new withdrawal order ID or query withdrawal history before retrying." },
  "-2021": { reason: "IDENTITY_VERIFICATION_REQUIRED", suggestedAction: "Complete the account verification required by the tenant before retrying." },
  "-2022": { reason: "LIMIT_ORDER_VOLUME_TOO_SMALL", suggestedAction: "Increase the limit-order volume to the returned minimum." },
  "-2023": { reason: "MARKET_ORDER_VOLUME_TOO_SMALL", suggestedAction: "Increase the market-order sell volume to the returned minimum." },
  "-2024": { reason: "LIMIT_ORDER_PRICE_TOO_SMALL", suggestedAction: "Increase the limit-order price to the returned minimum." },
  "-2025": { reason: "MARKET_ORDER_AMOUNT_TOO_SMALL", suggestedAction: "Increase the market-order buy amount to the returned minimum." },
  "-2026": { reason: "BUY_AMOUNT_TOO_LARGE", suggestedAction: "Reduce the buy amount before creating a new preview." },
  "-2027": { reason: "SELL_AMOUNT_TOO_LARGE", suggestedAction: "Reduce the sell amount before creating a new preview." },
  "-2029": { reason: "LIMIT_ORDER_NOTIONAL_TOO_SMALL", suggestedAction: "Increase the limit-order notional amount to the returned minimum." },
  "-2030": { reason: "TRANSFER_NOT_FOUND", suggestedAction: "Verify the transfer ID, or query by the documented source and destination accounts." },
  "-2031": { reason: "TRANSFER_TYPE_UNSUPPORTED", suggestedAction: "Use a supported source and destination account combination." },
  "-2033": { reason: "ASSET_TRANSFER_FAILED", suggestedAction: "Query transfer history before attempting another transfer." },
  "-2034": { reason: "SUB_ACCOUNT_RELATION_NOT_FOUND", suggestedAction: "Use a sub-account that belongs to the authenticated parent account." },
  "-2035": { reason: "SUB_ACCOUNT_API_KEY_NOT_FOUND", suggestedAction: "Verify the sub-account API key identifier before retrying." },
  "-2036": { reason: "SUB_ACCOUNT_PERMISSION_DENIED", suggestedAction: "Use a parent-account credential with the required sub-account permission." },
  "-2037": { reason: "SUB_ACCOUNT_CREATION_FAILED", suggestedAction: "Check the sub-account limit and requested identifier before creating a new preview." },
  "-2038": { reason: "SUB_ACCOUNT_UPDATE_FAILED", suggestedAction: "Query the latest sub-account state before retrying the update." },
  "-2040": { reason: "SUB_ACCOUNT_CREDENTIAL_REQUIRED", suggestedAction: "Use the sub-account credential required by this endpoint." },
  "10001": { reason: "USER_ACCOUNT_LOCKED", suggestedAction: "The account is restricted. Contact the platform administrator." },
  "10004": { reason: "USER_NOT_AUTHENTICATED", suggestedAction: "Configure valid credentials for the selected profile." },
  "10005": { reason: "PERMISSION_DENIED", suggestedAction: "Verify the API key permissions and the tenant feature permission." },
  "10006": { reason: "TENANT_PERMISSION_DENIED", suggestedAction: "Ask the tenant administrator to enable this capability." },
  "21018": { reason: "SUB_ACCOUNT_NOT_FOUND", suggestedAction: "List sub-accounts and use an existing sub-account ID." },
  "21019": { reason: "COIN_NOT_FOUND", suggestedAction: "Query supported coins and use an exact coin symbol." },
  "21020": { reason: "SYMBOL_NOT_FOUND", suggestedAction: "Query supported symbols and use an exact symbol value." },
  "21022": { reason: "ORDER_NOT_FOUND", suggestedAction: "Verify the order identifier and symbol, then query current orders if needed." },
  "21024": { reason: "SUB_ACCOUNT_FEATURE_PERMISSION_DENIED", suggestedAction: "Enable the required sub-account feature permission before retrying." },
  "21025": { reason: "SUB_ACCOUNT_LIMIT_REACHED", suggestedAction: "The parent account has reached its sub-account limit." }
};

const endpointErrors: Readonly<Record<string, ErrorDefinition>> = {
  "/sapi/v1/withdraw/query:10005": { reason: "WITHDRAW_HISTORY_PERMISSION_DENIED", suggestedAction: "Enable the withdrawal-history permission for this API key, then retry." },
  "/sapi/v1/withdraw/query:-2015": { reason: "WITHDRAW_HISTORY_TRUSTED_IP_REQUIRED", suggestedAction: "Add a trusted IP to the API key before querying withdrawal history." },
  "/sapi/v1/withdraw/query:-1004": { reason: "WITHDRAW_HISTORY_PARENT_ACCOUNT_REQUIRED", suggestedAction: "Use a parent-account credential for withdrawal history." },
  "/sapi/v1/sub_user/asset/root_transfer_query:-2036": { reason: "ROOT_SUB_TRANSFER_PARENT_PERMISSION_REQUIRED", suggestedAction: "Use a parent-account credential that can access the requested sub-account." },
  "/sapi/v1/sub_user/asset/transfer_query:-2034": { reason: "SUB_ACCOUNT_INTERNAL_TRANSFER_RELATION_NOT_FOUND", suggestedAction: "Use a sub-account that belongs to the authenticated parent account." },
  "/sapi/v1/asset/subaccount/transfer_query:-2040": { reason: "PARENT_TRANSFER_SUB_ACCOUNT_REQUIRED", suggestedAction: "Run this query with the relevant sub-account credential." }
};

function normalizeCode(value: string | number): string {
  return String(value).trim();
}

export function diagnoseOpenApiBusinessError(
  path: string,
  upstreamCode: string | number,
  upstreamMessage: string
): OpenApiBusinessDiagnosis {
  const code = normalizeCode(upstreamCode);
  const definition = endpointErrors[`${path}:${code}`] ?? globalErrors[code];
  if (!definition) {
    return {
      upstreamCode: code,
      upstreamMessage,
      reason: "UNKNOWN_UPSTREAM_CODE",
      suggestedAction: "Review the upstream message and endpoint. Do not retry a state-changing request automatically.",
      retryable: false,
      writeOutcomeUnknown: false
    };
  }
  return {
    upstreamCode: code,
    upstreamMessage,
    reason: definition.reason,
    suggestedAction: definition.suggestedAction,
    retryable: definition.retryable ?? false,
    writeOutcomeUnknown: definition.writeOutcomeUnknown ?? false
  };
}

export function isOpenApiSuccessCode(value: unknown): boolean {
  return value === 0 || value === "0";
}
