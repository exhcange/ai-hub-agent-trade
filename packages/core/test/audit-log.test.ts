import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { auditDirectory, FileAuditLogger } from "../src/index.js";

test("uses the documented local audit directory for each desktop OS", () => {
  assert.equal(auditDirectory({ home: "/home/tester", os: "darwin", environment: {} }), "/home/tester/Library/Logs/AIHub");
  assert.equal(auditDirectory({ home: "/home/tester", os: "win32", environment: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" } }), "C:\\Users\\tester\\AppData\\Local/AIHub/logs");
  assert.equal(auditDirectory({ home: "/home/tester", os: "linux", environment: {} }), "/home/tester/.local/state/ai-hub");
  assert.equal(auditDirectory({ home: "/home/tester", os: "linux", environment: { XDG_STATE_HOME: "/state" } }), "/state/ai-hub");
  assert.equal(auditDirectory({ home: "/home/tester", os: "linux", environment: { AI_HUB_AUDIT_DIR: "/safe/audit" } }), "/safe/audit");
});

test("writes only safe lifecycle metadata and retains seven days", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-hub-audit-"));
  await writeFile(join(directory, "audit-2026-07-01.jsonl"), "old\n");
  const now = new Date("2026-07-09T12:34:56.000Z");
  const logger = new FileAuditLogger(directory, () => now, "linux");

  await logger.record({
    event: "prepared",
    profile: "default",
    tool: "spot_limit_order",
    confirmationId: "confirmation-id",
    requestHash: "a".repeat(64),
    openApi: { method: "POST", path: "/sapi/v2/order" }
  });

  const files = await readdir(directory);
  assert.ok(!files.includes("audit-2026-07-01.jsonl"));
  const file = join(directory, "audit-2026-07-09.jsonl");
  const line = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(line).sort(), ["confirmationId", "event", "openApi", "profile", "requestHash", "timestamp", "tool"]);
  assert.deepEqual(line.openApi, { method: "POST", path: "/sapi/v2/order" });
  assert.doesNotMatch(JSON.stringify(line), /apiKey|secret|address|payload|response/i);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});
