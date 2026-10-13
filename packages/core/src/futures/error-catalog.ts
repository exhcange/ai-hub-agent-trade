import { AiHubError, OpenApiBusinessError, type OpenApiBusinessDiagnosis } from "../errors.js";
import type { FuturesEndpoint } from "./api.js";

type Definition = readonly [key: string, message: string, reason?: string];

// Source: Futures OpenCode / ApiResultToOpenCode. Meanings deliberately stay
// separate from Spot, which uses some of the same codes for different errors.
const ERRORS: Readonly<Record<string, Definition>> = {
  "-1000": ["UNKNOWN", "An unknown error occurred while processing the request."],
  "-1001": ["DISCONNECTED", "The upstream service could not process the request."],
  "-1002": ["UNAUTHORIZED", "An API key is required."],
  "-1003": ["TOO_MANY_REQUESTS", "The request rate limit was exceeded."],
  "-1006": ["UNEXPECTED_RESP", "The upstream response was unexpected; execution is unknown."],
  "-1007": ["TIMEOUT", "The upstream service timed out; execution is unknown."],
  "-1015": ["TOO_MANY_ORDERS", "The number of orders exceeds the limit."],
  "-1021": ["INVALID_TIMESTAMP", "The request timestamp is invalid."],
  "-1022": ["INVALID_SIGNATURE", "The request signature is invalid."],
  "-1100": ["ILLEGAL_CHARS", "The request contains invalid characters."],
  "-1102": ["MANDATORY_PARAM_EMPTY_OR_MALFORMED", "A required parameter is missing or malformed."],
  "-1103": ["UNKNOWN_PARAM", "The request contains an unsupported parameter."],
  "-1111": ["BAD_PRECISION", "The requested precision exceeds the asset limit."],
  "-1121": ["BAD_SYMBOL", "The contract is invalid."],
  "-1136": ["ORDER_QUANTITY_TOO_SMALL", "The order quantity is below the minimum."],
  "-1137": ["ORDER_QUANTITY_TOO_BIG", "The order quantity exceeds the maximum."],
  "-1138": ["ORDER_PRICE_WAVE_EXCEED", "The order price is outside the allowed range.", "ORDER_PRICE_OUT_OF_RANGE"],
  "-1140": ["ORDER_POSITION_LIMIT", "The order exceeds the position limit."],
  "-1145": ["ORDER_NOT_SUPPORT_CANCELLATION", "The order cannot be cancelled in its current state."],
  "-1146": ["ORDER_CONTRACT_NOT_OPEN", "The contract is not currently tradable."],
  "-1147": ["INSUFFICIENT_USER_AVAILABLE_BALANCE", "The available account balance is insufficient.", "INSUFFICIENT_BALANCE"],
  "-1148": ["THE_TOTAL_AMOUNT_OF_PENDING_ORDERS_EXCEEDS_THE_LIMIT", "The total pending order quantity exceeds the limit."],
  "-1149": ["THE_ORDER_QUANTITY_IS_LESS_THAN_THE_MINIMUM_LIMIT_QUANTITY", "The order quantity is below the minimum."],
  "-1150": ["THE_ORDER_AMOUNT_IS_LESS_THAN_THE_MINIMUM_LIMIT_AMOUNT", "The order amount is below the minimum."],
  "-1151": ["THE_ORDER_QUANTITY_IS_GREATER_THAN_THE_MAXIMUM_LIMIT", "The order quantity exceeds the maximum."],
  "-1152": ["THE_ORDER_AMOUNT_IS_GREATER_THAN_THE_MAXIMUM_LIMIT_AMOUNT", "The order amount exceeds the maximum."],
  "-1153": ["INSUFFICIENT_TRADING_DEPTH", "There is insufficient market depth."],
  "-1154": ["THE_PRICE_EXCEEDS_THE_SET_DEVIATION_RANGE", "The order price exceeds the permitted deviation range.", "ORDER_PRICE_OUT_OF_RANGE"],
  "-1155": ["PRICE_ACCURACY_ERROR", "The order price precision is invalid.", "INVALID_PRICE_PRECISION"],
  "-1156": ["LEVERAGE_EXCEEDS_THE_LIMIT", "The leverage exceeds the permitted limit."],
  "-1157": ["THE_POSITION_HAS_BEEN_LOCKED_AND_CANNOT_PLACE_AN_ORDER", "The position is locked; orders cannot be placed."],
  "-1158": ["CLOSING_POSITIONS_EXCEEDING_THE_TOTAL_POSITION_AMOUNT", "The closing quantity exceeds the position quantity."],
  "-1160": ["USER_TRANSACTIONS_ARE_FROZEN", "Trading is disabled for this account."],
  "-1163": ["THE_CONTRACT_CONFIGURATION_INFORMATION_DOES_NOT_EXIST", "The contract configuration does not exist."],
  "-1164": ["ORDER_CANCELLATION_FAILED", "The order cancellation failed."],
  "-1165": ["QUANTITY_PRECISION_ERROR", "The order quantity precision is invalid."],
  "-1188": ["THE_EXPECTED_TRANSACTION_PRICE_DEVIATES_TOO_MUCH_FROM_THE_LATEST_PRICE_AND_THE_ORDER_CANNOT_BE_SUBMITTED", "The expected execution price deviates too far from the latest price.", "ORDER_PRICE_OUT_OF_RANGE"],
  "-1196": ["THE_ORDER_DOES_NOT_EXIST", "The order does not exist.", "ORDER_NOT_FOUND"],
  "-1206": ["THIS_CONTRACT_CURRENTLY_HAS_AN_ORDER/POSITION, AND_THE_POSITION_TYPE_CANNOT_BE_ADJUSTED", "Existing orders or positions prevent this mode change."],
  "-1207": ["THE_USER_HAS_NOT_OPENED_THE_CONTRACT_TRANSACTION", "Futures trading has not been enabled for this account."],
  "-1208": ["THE_CURRENT_USER_HAS_A_POSITION_IN_THIS_CONTRACT", "The account has an existing position in this contract."],
  "-1209": ["THE_CURRENT_USER_HAS_AN_ORDER_FOR_THIS_CONTRACT", "The account has an existing order in this contract."],
  "-1210": ["THE_LIMIT_ORDER_QUANTITY_MUST_BE_AN_INTEGER", "Limit order quantity must be an integer."],
  "-1211": ["LIMIT_ORDER_PRICE_PARAMETER_ERROR", "The limit order price is invalid."],
  "-1212": ["INSUFFICIENT_MARKET_DEPTH, THE_COMMISSION_CANNOT_BE_SUBMITTED", "There is insufficient market depth to submit this order."],
  "-1213": ["THERE_IS_A_POSSIBILITY_OF_LIQUIDATION_IN_THE_CURRENT_ORDER, AND_THE_ORDER_CANNOT_BE_PLACED", "The order could cause liquidation and cannot be placed."],
  "-2013": ["THE_ORDER_DOES_NOT_EXIST", "The order does not exist.", "ORDER_NOT_FOUND"],
  "-2014": ["INVALID_API_KEY_FORMAT", "The API key format is invalid."],
  "-2015": ["INVALID_API_KEY, IP_OR_OPERATION_PERMISSIONS", "API key, IP restriction or operation permission validation failed."],
  "-2017": ["INSUFFICIENT_BALANCE", "The account balance is insufficient."],
  "-2200": ["SUBMITTING_THE_COMMISSION_FAILED!", "Order submission failed."],
  "-3001": ["YOUR_API_DOES_NOT_HAVE_CONTRACT_TRANSACTION_PERMISSIONS_ENABLED, PLEASE_CONFIRM_AND_TRY_AGAIN", "The API key does not have Futures trading permission."],
  "-3002": ["THE_MERCHANT_INFORMATION_IS_INCORRECT, PLEASE_CONTACT_THE_ADMINISTRATOR", "The platform account information is invalid; contact the platform administrator."],
  "-3007": ["USER_HAS_ORDERS, CANNOT_ADJUST_LEVERAGE", "Existing orders prevent a leverage change."]
};

// Only established pre-dispatch rejections are safe for every write. Do not
// infer failure from a numeric range or from a message that happens to match.
const REQUEST_REJECTIONS = new Set(["-1002", "-1021", "-1022", "-1100", "-1102", "-1103", "-1111", "-1121", "-2014", "-2015"]);
// Ordinary-order price validation returns before executeOrder is called.
// Do not apply this evidence to batch/trigger submissions or setting changes.
const ORDER_REJECTIONS = new Set(["-1154", "-1155", "-1188"]);
const UNKNOWN_CODES = new Set(["-1000", "-1001", "-1006", "-1007"]);
const VERIFY = "Do not retry automatically. Query the original operation before taking another action.";

function definition(endpoint: FuturesEndpoint, code: string): Definition | undefined {
  // These endpoints can return the internal ApiResultVo instead of OpenCode.
  // Decode its meaning without assuming the entire write was rejected.
  if (["conditionOrder", "profitLossOrder"].includes(endpoint) && code === "10010") return ERRORS["-1154"];
  return ERRORS[code];
}

export function futuresBusinessError(endpoint: FuturesEndpoint, codeValue: unknown, messageValue: unknown, write: boolean): AiHubError {
  const code = typeof codeValue === "string" && /^-?\d{1,16}$/.test(codeValue) ? codeValue : "unrecognized";
  const known = definition(endpoint, code);
  // Never echo unchecked server text: it may contain headers, credentials,
  // raw request bodies or instructions. Preserve only source-verified static
  // text; otherwise identify the local explanation as a catalog fallback.
  const verifiedMessage = typeof messageValue === "string" && known && (messageValue === known[0] || messageValue === known[1]);
  const upstreamMessage = verifiedMessage ? messageValue : known?.[1] ?? "OpenAPI returned an unrecognized business error; its message was omitted.";
  const unknown = write && !REQUEST_REJECTIONS.has(code) && !(endpoint === "order" && ORDER_REJECTIONS.has(code));
  const reason = known?.[2] ?? known?.[0] ?? "UNKNOWN_UPSTREAM_CODE";
  const suggestedAction = unknown ? VERIFY : reason === "ORDER_PRICE_OUT_OF_RANGE"
    ? "Choose a price within the permitted range, then create a new preview and obtain a new confirmation. Do not retry automatically."
    : reason === "ORDER_NOT_FOUND"
      ? "Verify the contract and order ID. A missing order does not establish the outcome of an earlier write."
      : "Review the API error and correct the request or account settings before a new preview. Do not retry a write automatically.";
  const diagnosis: OpenApiBusinessDiagnosis = {
    upstreamCode: code, upstreamMessage,
    upstreamMessageSource: verifiedMessage ? "api" : known ? "catalog" : "unavailable",
    reason, suggestedAction, retryable: false,
    writeOutcomeUnknown: unknown || (!write && UNKNOWN_CODES.has(code))
  };
  if (unknown) return new AiHubError("AI_HUB_WRITE_RESULT_UNKNOWN", `OpenAPI business error ${code}: ${upstreamMessage}`, diagnosis as unknown as Record<string, unknown>);
  return new OpenApiBusinessError(diagnosis);
}

/** Retain the safe diagnostic fields across the durable write-state wrapper. */
export function futuresErrorEvidence(error: unknown): Record<string, unknown> {
  if (!(error instanceof AiHubError)) return {};
  const details = error.details;
  if (!details) return {};
  return Object.fromEntries(["upstreamCode", "upstreamMessage", "upstreamMessageSource", "reason", "suggestedAction"]
    .filter((key) => typeof details[key] === "string").map((key) => [key, details[key]]));
}
