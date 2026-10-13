import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiHubFuturesApi, FUTURES_ENDPOINTS, futuresContract } from "../src/futures/api.js";
import { parseLosslessJson, fileRequestScheduler } from "../src/futures/transport.js";
import { FuturesWriteState } from "../src/futures/write-state.js";
import { futuresTools } from "../src/futures/tools.js";
import { validateHalfYear } from "../src/futures/validation.js";
import { ConfigStore, createToolRegistry, AiHubSpotApi, AiHubError, signRequest } from "../src/index.js";
import { selectMcpToolset } from "../src/tools/mcp-toolset.js";
const scheduler = async <T>(_key: string, _deadline: number, send: () => Promise<T>) => send();
const credentials = { apiKey: "fixture-key", secretKey: "fixture-secret" };
const context = { profile: { name: "futures", product: "futures" as const, openApiBaseUrl: "https://example.com", configVersion: "fixture" }, api: new AiHubSpotApi("https://example.com") };

test("Futures inventory contains 25 approved HTTP identities and 26 semantic tools", () => {
  assert.equal(Object.keys(FUTURES_ENDPOINTS).length, 25);
  assert.equal(futuresTools.length, 26);
  assert.equal(new Set(futuresTools.map((t) => `${t.openApiContract!.method} ${t.openApiContract!.path}`)).size, 25);
  assert.equal(futuresTools.filter((t) => t.operation === "write").length, 10);
  assert.equal(futuresContract("orderDetail").method, "GET");
});
test("lossless parser preserves decimal and signed/exponent numeric tokens, escaped strings, and rejects malformed JSON", () => {
  assert.deepEqual(parseLosslessJson('{"id":9223372036854775807,"amount":0.1234567890123456789,"delta":-0.00000000000001,"v":1e-10,"s":"price \\"123\\""}'), { id: "9223372036854775807", amount: "0.1234567890123456789", delta: "-0.00000000000001", v: "1e-10", s: 'price "123"' });
  assert.throws(() => parseLosslessJson('{"x":01}'));
});
test("signed Futures reads sign exact query bytes and only selected endpoints carry version header", async () => {
  const requests: { url: string; headers: Headers; body: string | undefined }[] = [];
  const client = new AiHubFuturesApi("https://example.com", { scheduler, fetch: async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: init?.body as string | undefined });
    return new Response('{"code":0,"data":[]}');
  } });
  await client.request("orderDetail", { contractName: "E-BTC-USDT", clientOrderId: "a+b" }, credentials);
  await client.request("trigger_order_list", { contractName: "E-BTC-USDT", page: 1, limit: 20 }, credentials);
  const first = requests[0]!;
  assert.match(first.url, /clientOrderId=a%2Bb/);
  assert.equal(first.headers.get("X-CH-SIGN"), signRequest(first.headers.get("X-CH-TS")!, "GET", "/fapi/v1/order", credentials.secretKey, new URL(first.url).search.slice(1)));
  assert.equal(first.headers.get("futures-version"), null);
  assert.equal(requests[1]!.headers.get("futures-version"), "101");
});
test("read-only POST may retry once; writes never retry network or malformed responses", async () => {
  let calls = 0;
  const read = new AiHubFuturesApi("https://example.com", { scheduler, fetch: async () => { if (++calls === 1) throw new Error("network"); return new Response("[]"); } });
  assert.deepEqual(await read.request("orderHistorical", {}, credentials), []);
  assert.equal(calls, 2);
  for (const malformed of [true, false]) {
    calls = 0;
    const write = new AiHubFuturesApi("https://example.com", { scheduler, fetch: async () => { calls++; if (malformed) return new Response("not JSON"); throw new Error("network"); } });
    await assert.rejects(write.request("order", {}, credentials), { code: "AI_HUB_WRITE_RESULT_UNKNOWN" });
    assert.equal(calls, 1);
  }
});
test("Core prevents cross-product requests and direct write execution", async () => {
  const registry = createToolRegistry();
  await assert.rejects(registry.execute("account_list_balances", {}, context), { code: "AI_HUB_PRODUCT_MISMATCH" });
  await assert.rejects(registry.execute("futures_place_order", {}, context), { code: "AI_HUB_WRITE_CONFIRMATION_REQUIRED" });
  assert.ok(registry.list({ product: "spot" }).every((t) => t.product !== "futures"));
});
test("order validation rejects ambiguous units, wrong selectors and MARKET limit price", () => {
  const registry = createToolRegistry();
  const input = { contractName: "E-BTC-USDT", intent: "open-long", type: "MARKET", unit: "contracts", quantity: "2", marginMode: "isolated" };
  assert.throws(() => registry.byName("futures_place_order").validate({ ...input, price: "10" }));
  assert.throws(() => registry.byName("futures_place_order").validate({ ...input, quantity: "1.5" }));
  assert.throws(() => registry.byName("futures_order_detail").validate({ contractName: "E-BTC-USDT", orderId: "1", clientOrderId: "a" }));
  assert.throws(() => registry.byName("futures_cancel_all_orders").validate({}));
  const prepared = registry.byName("futures_place_order").validate(input);
  assert.equal(String(prepared.clientOrderId).length, 31);
});
test("empty Futures open-orders success with null data is normalized as an empty list", async () => {
  const client = new AiHubFuturesApi("https://example.com", { scheduler, fetch: async () => new Response('{"code":0,"data":null}') });
  const result = await createToolRegistry().execute("futures_open_orders", { contractName: "E-BTC-USDT", limit: 20 }, {
    ...context,
    credentials: { ...credentials, credentialVersion: "fixture-version" },
    futuresApi: client
  }) as { items: unknown[]; returnedCount: number; truncated: boolean };
  assert.deepEqual(result, { items: [], returnedCount: 0, truncated: false, continuation: null, upstreamCompleteness: "not_established" });
});
test("half-year range clamps calendar month ends and rejects incomplete ranges", () => {
  validateHalfYear({ startTime: Date.UTC(2026, 7, 31), endTime: Date.UTC(2027, 1, 28) });
  assert.throws(() => validateHalfYear({ startTime: Date.UTC(2026, 7, 31), endTime: Date.UTC(2027, 2, 1) }));
  assert.throws(() => validateHalfYear({ startTime: 1 }));
});
test("profile product survives credential updates and changing endpoint removes credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "futures-config-"));
  try {
    const store = new ConfigStore(join(directory, "config.toml"));
    await store.setProfile("futures", "https://8.8.8.8", "futures");
    await store.setCredentials("futures", credentials);
    assert.equal((await store.showProfile("futures")).product, "futures");
    await store.setProfile("futures", "https://1.1.1.1");
    assert.equal(await store.getCredentials("futures"), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("transfer toolset rejects unrelated account types in both validation and confirmed handler", async () => {
  const tools = selectMcpToolset(createToolRegistry().list(), "transfer");
  assert.equal(tools.length, 3);
  const transfer = tools.find((t) => t.name === "wallet_universal_transfer")!;
  assert.throws(() => transfer.validate({ fromAccountType: "1", toAccountType: "3", coinSymbol: "USDT", amount: "1" }));
  await assert.rejects(transfer.handler({ fromAccountType: "1", toAccountType: "3" }, context), { code: "AI_HUB_TOOL_NOT_AVAILABLE" });
});
test("durable uncertain write survives a new store and blocks changed intent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "futures-state-"));
  try {
    const store = new FuturesWriteState(directory);
    await assert.rejects(store.execute("account", "place", async () => { throw new AiHubError("AI_HUB_WRITE_RESULT_UNKNOWN", "unknown"); }));
    await assert.rejects(new FuturesWriteState(directory).execute("account", "change-mode", async () => "bad"), { code: "AI_HUB_UNRESOLVED_WRITE_EXISTS" });
    assert.equal(await store.execute("other-account", "place", async () => "ok"), "ok");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("independent schedulers enforce same-interface start spacing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "futures-slots-"));
  try {
    const starts: number[] = [];
    await Promise.all([fileRequestScheduler(directory), fileRequestScheduler(directory)].map((schedule) => schedule("same", Date.now() + 5000, async () => { starts.push(Date.now()); })));
    assert.ok(starts[1]! - starts[0]! >= 1000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("all ten writes require a separate confirmation and dispatch once with correct endpoint bodies", async () => {
  const { ConfirmationService, ToolWriteExecutor } = await import("../src/index.js");
  const directory = await mkdtemp(join(tmpdir(), "futures-confirm-"));
  try {
    const registry = createToolRegistry();
    const writes: { path: string; body: Record<string, unknown>; version: string | null }[] = [];
    let selected = "";
    const client = new AiHubFuturesApi("https://example.com", { scheduler, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/contracts")) return new Response(JSON.stringify([{ symbol: "E-BTC-USDT", status: 1, pricePrecision: 2, minOrderVolume: 1, maxLimitVolume: 1000, maxMarketVolume: 1000, minLever: 1, maxLever: 100 }]));
      if (path.endsWith("/account")) return new Response(JSON.stringify({ account: [{ marginCoin: "USDT", positionVos: [{ contractName: "E-BTC-USDT", positions: ["futures_adjust_position_margin", "futures_place_profit_loss_order"].includes(selected) ? [{ id: "10", status: 1, side: "SELL", positionType: 2, freezeLock: 0, volume: "20" }] : [] }] }] }));
      if (path.endsWith("/openOrders")) return new Response('{"code":0,"data":null}');
      if (init?.method === "GET" && path.endsWith("/order")) return new Response('{"orderId":"12","status":"NEW"}');
      const body = JSON.parse(String(init?.body));
      writes.push({ path, body, version: new Headers(init?.headers).get("futures-version") });
      if (path.endsWith("/order")) return new Response('{"orderId":9223372036854775807}');
      if (path.endsWith("/conditionOrder") || path.endsWith("/profitLossOrder")) return new Response('{"code":0,"data":{"triggerIds":["22"],"ids":[]}}');
      return new Response('{"code":0,"data":null}');
    } });
    const ctx = { ...context, futuresApi: client, futuresWrites: new FuturesWriteState(directory), credentials: { ...credentials, credentialVersion: "fixture-version" } };
    const executor = new ToolWriteExecutor(registry, new ConfirmationService(), { record: async () => undefined });
    const place = { contractName: "E-BTC-USDT", intent: "open-long", type: "LIMIT", unit: "contracts", quantity: "2", price: "100.00", marginMode: "isolated" };
    const cases: [string, Record<string, unknown>][] = [
      ["place_order", place], ["place_condition_order", { ...place, triggerPrice: "101", triggerType: "3UP" }],
      ["place_profit_loss_order", { contractName: "E-BTC-USDT", side: "BUY", orderList: [{ type: 2, triggerType: 1, volume: "1", triggerPrice: "101" }] }],
      ["cancel_order", { contractName: "E-BTC-USDT", orderId: "12" }], ["cancel_all_orders", { scope: "all-ordinary-orders" }],
      ["cancel_trigger_order", { contractName: "E-BTC-USDT", orderIds: ["22", "23"] }],
      ["set_position_mode", { contractName: "E-BTC-USDT", positionModel: 2 }], ["set_margin_mode", { contractName: "E-BTC-USDT", marginModel: 2 }],
      ["adjust_position_margin", { positionId: "10", amount: "-0.25" }], ["set_leverage", { contractName: "E-BTC-USDT", nowLevel: 5 }]
    ];
    for (const [name, input] of cases) {
      selected = `futures_${name}`;
      const before = writes.length;
      const preview = await executor.prepare(selected, input, ctx);
      assert.equal(writes.length, before, `${name} must not write during prepare`);
      assert.equal(preview.requiresNewUserConfirmation, true);
      await executor.confirm(preview.confirmationId, "Confirm this preview", ctx);
      assert.equal(writes.length, before + 1);
      await assert.rejects(executor.confirm(preview.confirmationId, "Confirm again", ctx));
      assert.equal(writes.length, before + 1);
    }
    assert.equal(writes[1]!.body.triggerType, 3);
    assert.deepEqual(writes[4]!.body, {});
    assert.equal(writes[0]!.body.orderUnit, 2);
    assert.equal(writes[0]!.body.side, "BUY");
    assert.equal(writes[0]!.version, "101");
    assert.equal(writes[8]!.body.amount, "-0.25");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("filtered transaction pages preserve continuation, include type 28, and suppress internal fields", async () => {
  const client = new AiHubFuturesApi("https://example.com", { scheduler, fetch: async () => new Response(JSON.stringify({ code: 0, data: { transList: [{ id: "1", scene: 18, uid: 7 }, { id: "2", scene: 28, amount: "1.25", uid: 7 }, { id: "3", scene: 10, amount: "2" }], count: 100 } })) });
  const result = await createToolRegistry().execute("futures_transactions", { symbol: "USDT", beginTime: Date.UTC(2026, 0, 1), endTime: Date.UTC(2026, 1, 1), limit: 3 }, { ...context, credentials: { ...credentials, credentialVersion: "v" }, futuresApi: client }) as { items: { id: string }[]; continuation: unknown };
  assert.deepEqual(result.items.map((row) => row.id), ["2", "3"]);
  assert.deepEqual(result.continuation, { page: 2, limit: 3 });
  assert.equal(JSON.stringify(result).includes("uid"), false);
});

test("snapshot continuation is immutable and bound to profile/query without dropping records", async () => {
  const { FuturesSnapshots } = await import("../src/futures/snapshots.js");
  const directory = await mkdtemp(join(tmpdir(), "futures-pages-"));
  try {
    const snapshots = new FuturesSnapshots(directory), binding = { profile: "futures", filter: "BTC" };
    const first = await snapshots.first([{ id: "1" }, { id: "2" }, { id: "3", uid: "hidden" }], 2, binding) as { continuation: { cursor: string } };
    await assert.rejects(snapshots.next(first.continuation.cursor, 2, { profile: "other" }));
    const next = await snapshots.next(first.continuation.cursor, 2, binding) as { items: unknown[]; continuation: unknown };
    assert.deepEqual(next.items, [{ id: "3" }]); assert.equal(next.continuation, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("migration dry run preserves configuration and pairing invalidates on credential change", async () => {
  const directory = await mkdtemp(join(tmpdir(), "futures-migration-"));
  try {
    const store = new ConfigStore(join(directory, "config.toml"));
    await store.setProfile("old-spot", "https://8.8.8.8");
    await store.setProfile("old-futures", "https://1.1.1.1");
    await store.migrateProducts({ spot: "old-spot", futures: "old-futures" });
    assert.equal((await store.showProfile("old-spot")).product, "spot");
    await assert.rejects(store.showProfile("futures"));
    await store.migrateProducts({ spot: "old-spot", futures: "old-futures" }, true);
    await store.pairProducts("fixture-evidence");
    assert.ok((await store.showProfile("spot")).accountPairing);
    await store.setCredentials("futures", credentials);
    assert.equal((await store.showProfile("spot")).accountPairing, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("expired confirmation cannot dispatch after a rate-slot wait", async () => {
  let calls = 0;
  const client = new AiHubFuturesApi("https://example.com", { scheduler, fetch: async () => { calls++; return new Response("{}"); } });
  await assert.rejects(client.request("order", {}, credentials, Date.now() - 1), { code: "AI_HUB_CONFIRMATION_EXPIRED" });
  assert.equal(calls, 0);
});

test("unknown contract-scoped writes do not block unrelated contracts and resolve only with evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "futures-conflicts-"));
  try {
    const state = new FuturesWriteState(directory);
    await assert.rejects(state.execute("account", "futures_place_order", async () => { throw new Error("lost response"); }, { contractName: "BTC" }));
    assert.equal(await state.execute("account", "futures_place_order", async () => "ok", { contractName: "ETH" }), "ok");
    await assert.rejects(state.execute("account", "futures_set_position_mode", async () => "bad"));
    await state.resolveWithEvidence("account", "executed", "order:123");
    assert.equal(await state.execute("account", "futures_place_order", async () => "ok", { contractName: "BTC" }), "ok");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Futures expired status is distinct from spot rejection and counterparty order IDs are omitted", async () => {
  const { ordinaryOrderView } = await import("../src/futures/normalize.js");
  assert.deepEqual(ordinaryOrderView({ status: "6", orderId: "12", uid: "private" }), { status: "6", statusName: "EXPIRED", orderId: "12" });
  assert.deepEqual(ordinaryOrderView({ tradeId: "9", isBuyer: true, bidId: "12", askId: "99", askUserId: "private" }), { tradeId: "9", isBuyer: true, orderId: "12" });
});

test("both Futures transfer directions recheck balances, strip preview fields and preserve unknown operation IDs", async () => {
  const { ConfirmationService, ToolWriteExecutor } = await import("../src/index.js");
  const directory = await mkdtemp(join(tmpdir(), "futures-transfer-confirm-"));
  try {
    let available = "10", uncertain = false;
    const submitted: Record<string, unknown>[] = [];
    const registry = createToolRegistry();
    const ctx = {
      profile: { name: "spot", product: "spot", openApiBaseUrl: "https://transfer.example.com", configVersion: "fixture", accountPairing: { source: "operator-verified", evidenceId: "fixture-pair" } },
      credentials: { ...credentials, credentialVersion: "fixture" }, futuresWrites: new FuturesWriteState(directory),
      api: {
        symbols: async () => ({ symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }] }),
        signedPost: async (path: string, body: Record<string, unknown>) => {
          if (path.endsWith("/by_type")) return { code: "0", data: { accountList: [{ coinSymbol: "USDT", canTransferBalance: available }] } };
          submitted.push(body);
          if (uncertain) throw new Error("response lost");
          return { code: "0", data: null };
        }
      }
    } as never;
    const executor = new ToolWriteExecutor(registry, new ConfirmationService(), { record: async () => undefined });
    for (const [from, to] of [["1", "5"], ["5", "1"]]) {
      const preview = await executor.prepare("wallet_universal_transfer", { fromAccountType: from, toAccountType: to, coinSymbol: "USDT", amount: "1" }, ctx);
      assert.equal(preview.summary.sourceTransferableBalance, "10");
      const count = submitted.length;
      await executor.confirm(preview.confirmationId, "Confirm this transfer", ctx);
      assert.equal(submitted.length, count + 1);
      assert.deepEqual(submitted.at(-1), { fromAccountType: from, toAccountType: to, coinSymbol: "USDT", amount: "1" });
    }
    const input = { fromAccountType: "1", toAccountType: "5", coinSymbol: "USDT", amount: "2" };
    const insufficient = await executor.prepare("wallet_universal_transfer", input, ctx);
    available = "1";
    await assert.rejects(executor.confirm(insufficient.confirmationId, "Confirm", ctx), { code: "AI_HUB_INSUFFICIENT_BALANCE" });
    assert.equal(submitted.length, 2);
    available = "10"; uncertain = true;
    const unknown = await executor.prepare("wallet_universal_transfer", input, ctx);
    await assert.rejects(executor.confirm(unknown.confirmationId, "Confirm", ctx), (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_WRITE_RESULT_UNKNOWN" && typeof error.details?.operationId === "string");
    await assert.rejects(executor.prepare("wallet_universal_transfer", input, ctx), { code: "AI_HUB_UNRESOLVED_WRITE_EXISTS" });
    assert.equal(submitted.length, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a queued spot transfer cannot send after confirmation expiry", async () => {
  const client = new AiHubSpotApi("https://example.com", { requestScheduler: scheduler });
  await assert.rejects(client.signedPost("/sapi/v1/asset/universal_transfer", {}, credentials, Date.now() - 1), { code: "AI_HUB_CONFIRMATION_EXPIRED" });
});

test("Futures asset results use two decimals without losing large-value rounding or changing raw positions", async () => {
  const { accountView } = await import("../src/futures/normalize.js");
  const row = { marginCoin: "USDT", accountNormal: "1.005", accountLock: "0", partPositionNormal: "12.3", totalPositionNormal: "9.999", totalEquity: "9007199254740993.995", partEquity: "1e-3", achievedAmount: "-1.005", unrealizedAmount: "-0.004", positionVos: [{ contractName: "BTC", positions: [{ id: "1", status: "1", volume: "1", holdAmount: "1.005" }] }] };
  const value = { account: [row] };
  const assets = accountView(value, {}, false) as { items: Record<string, unknown>[] };
  assert.deepEqual(assets.items[0], { marginCoin: "USDT", accountNormal: "1.01", accountLock: "0.00", partPositionNormal: "12.30", totalPositionNormal: "10.00", totalEquity: "9007199254740994.00", partEquity: "0.00", achievedAmount: "-1.01", unrealizedAmount: "0.00" });
  assert.equal(row.accountNormal, "1.005");
  const positions = accountView(value, {}, true) as { items: Record<string, unknown>[] };
  assert.equal(positions.items[0]!.holdAmount, "1.005");
});

test("order, trigger, fill and position quantities carry contract units through output filtering", async () => {
  const { accountView, ordinaryOrderView, contractQuantityView, boundedList } = await import("../src/futures/normalize.js");
  const order = { orderId: "124", volume: "124", dealVolume: "24", price: "0.123456", dealMoney: "2.987654" };
  const normalized = ordinaryOrderView(order) as Record<string, unknown>;
  assert.equal(normalized.quantityUnit, "contracts");
  assert.deepEqual(normalized.quantityFields, ["volume", "dealVolume"]);
  assert.equal(normalized.volume, "124"); assert.equal(normalized.price, "0.123456");
  assert.equal(order.volume, "124");
  const triggers = boundedList(contractQuantityView([{ volume: "124.0", triggerPrice: "123.45" }]), 20) as { items: Record<string, unknown>[] };
  assert.equal(triggers.items[0]!.quantityUnit, "contracts");
  assert.equal(triggers.items[0]!.volume, "124.0");
  const positions = accountView({ account: [{ marginCoin: "USDT", positionVos: [{ contractName: "BTC", positions: [{ id: "124", status: "1", volume: "124", closeVolume: "2", pendingCloseVolume: "3", holdAmount: "1.2345" }] }] }] }, {}, true) as { items: Record<string, unknown>[] };
  assert.deepEqual(positions.items[0]!.quantityFields, ["volume", "closeVolume", "pendingCloseVolume"]);
  assert.equal(positions.items[0]!.quantityUnit, "contracts");
  assert.equal(positions.items[0]!.holdAmount, "1.2345");
  assert.equal((ordinaryOrderView({ tradeId: "1", volume: "5" }) as Record<string, unknown>).quantityUnit, "contracts");
});
