const ACTIVE_ORDER_STATUSES = new Set<unknown>(["NEW", "PART_FILLED", "PENDING_CANCEL", 1, 3, 5, "1", "3", "5"]);
const INACTIVE_ORDER_STATUSES = new Set<unknown>(["FILLED", "CANCELED", "REJECTED", "STOP_INIT", 2, 4, 6, 10, "2", "4", "6", "10"]);

function normalizedWorkingState(status: unknown): boolean | undefined {
  const normalizedStatus = typeof status === "string" ? status.trim().toUpperCase() : status;
  if (ACTIVE_ORDER_STATUSES.has(normalizedStatus)) return true;
  if (INACTIVE_ORDER_STATUSES.has(normalizedStatus)) return false;
  return undefined;
}

/**
 * Corrects the upstream isWorking compatibility field from the authoritative
 * server order status. Unknown statuses retain the upstream value unchanged.
 * The response shape and every other upstream field are preserved.
 */
export function normalizeOrderWorkingStatus(result: unknown): unknown {
  if (Array.isArray(result)) {
    let changed = false;
    const normalized = result.map((entry) => {
      const next = normalizeOrderWorkingStatus(entry);
      if (next !== entry) changed = true;
      return next;
    });
    return changed ? normalized : result;
  }
  if (!result || typeof result !== "object") return result;

  const value = result as Record<string, unknown>;
  const workingState = normalizedWorkingState(value.status);
  let changed = false;
  const normalizedEntries = Object.entries(value).map(([key, entry]) => {
    const next = normalizeOrderWorkingStatus(entry);
    if (next !== entry) changed = true;
    return [key, next] as const;
  });

  if (workingState !== undefined && value.isWorking !== workingState) {
    changed = true;
    const normalized = Object.fromEntries(normalizedEntries);
    normalized.isWorking = workingState;
    return normalized;
  }
  return changed ? Object.fromEntries(normalizedEntries) : result;
}
