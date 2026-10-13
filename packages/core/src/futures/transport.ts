import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AiHubError } from "../errors.js";
import { unresolvedWriteDirectory } from "../unresolved-write.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Cross-process local lock. Never steal a lock from a possibly running writer. */
export async function withLocalLock<T>(file: string, deadline: number, action: () => Promise<T>): Promise<T> {
  let lock;
  while (!lock) {
    try { lock = await open(file, "wx", 0o600); await lock.writeFile(String(process.pid)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Serialize orphan recovery; re-read under its own exclusive lock to avoid
      // removing a replacement lock acquired by another process.
      let recovery;
      try {
        recovery = await open(`${file}.recovery`, "wx", 0o600);
        const owner = Number(await readFile(file, "utf8"));
        if (Number.isSafeInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); }
          catch (probe) { if ((probe as NodeJS.ErrnoException).code === "ESRCH") await rm(file, { force: true }); }
        }
      } catch (recoveryError) {
        if (!["EEXIST", "ENOENT"].includes((recoveryError as NodeJS.ErrnoException).code ?? "")) throw recoveryError;
      } finally { if (recovery) { await recovery.close(); await rm(`${file}.recovery`, { force: true }); } }
      if (Date.now() + 25 >= deadline) throw new AiHubError("AI_HUB_LOCAL_STATE_BUSY", "Local coordination is busy. No request was dispatched by this attempt.");
      await sleep(25);
    }
  }
  try { return await action(); }
  finally { await lock.close().catch(() => undefined); await rm(file, { force: true }).catch(() => undefined); }
}

export type RequestScheduler = <T>(key: string, deadline: number, send: () => Promise<T>) => Promise<T>;

/** Serialize same-endpoint starts across CLI and MCP sharing a state directory. */
export function fileRequestScheduler(directory = join(unresolvedWriteDirectory(), "request-slots")): RequestScheduler {
  return async (key, deadline, send) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, createHash("sha256").update(key).digest("hex"));
    return withLocalLock(`${file}.lock`, deadline, async () => {
      let last = 0;
      try {
        last = Number(await readFile(file, "utf8"));
        if (!Number.isFinite(last) || last < 0) throw new Error("invalid slot");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new AiHubError("AI_HUB_LOCAL_STATE_INVALID", "Invalid request scheduling state.");
      }
      const wait = Math.max(0, last + 1_000 - Date.now());
      if (Date.now() + wait >= deadline) throw new AiHubError("AI_HUB_RATE_LIMITED", "Request budget exhausted while waiting for a rate slot.");
      if (wait) await sleep(wait);
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, String(Date.now()), { mode: 0o600 });
      await rename(temporary, file);
      try { return await send(); }
      finally {
        await writeFile(temporary, String(Date.now()), { mode: 0o600 });
        await rename(temporary, file);
      }
    });
  };
}

/** Preserve every numeric token before parsing; normalizers select safe integers. */
export function parseLosslessJson(raw: string): unknown {
  let out = "", index = 0;
  while (index < raw.length) {
    const c = raw[index]!;
    if (c === '"') {
      const start = index++;
      while (index < raw.length) {
        if (raw[index] === "\\") { index += 2; continue; }
        if (raw[index++] === '"') break;
      }
      out += raw.slice(start, index);
    } else if (c === "-" || /[0-9]/.test(c)) {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(index));
      if (!match) throw new SyntaxError("Invalid numeric token");
      out += JSON.stringify(match[0]); index += match[0].length;
    } else { out += c; index++; }
  }
  return JSON.parse(out);
}
