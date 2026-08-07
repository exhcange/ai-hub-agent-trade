import { appendFile, chmod, mkdir, readdir, rm } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { OpenApiContract } from "./tools/tool-spec.js";

const RETENTION_DAYS = 7;
const FILE_NAME = /^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export interface AuditRecord {
  event: "prepared" | "execution_started" | "succeeded" | "failed" | "outcome_unknown";
  profile: string;
  tool: string;
  confirmationId: string;
  requestHash: string;
  openApi: Pick<OpenApiContract, "method" | "path">;
  errorCode?: string;
  upstreamCode?: string;
}

export interface AuditLogger {
  record(entry: AuditRecord): Promise<void>;
}

export function auditDirectory(options: { home?: string; os?: NodeJS.Platform; environment?: NodeJS.ProcessEnv } = {}): string {
  const environment = options.environment ?? process.env;
  if (environment.AI_HUB_AUDIT_DIR) return environment.AI_HUB_AUDIT_DIR;
  const home = options.home ?? homedir();
  switch (options.os ?? platform()) {
    case "darwin": return join(home, "Library", "Logs", "AIHub");
    case "win32": return join(environment.LOCALAPPDATA || join(home, "AppData", "Local"), "AIHub", "logs");
    default: return join(environment.XDG_STATE_HOME || join(home, ".local", "state"), "ai-hub");
  }
}

function dateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function olderThanRetention(name: string, now: Date): boolean {
  const match = FILE_NAME.exec(name);
  if (!match?.[1]) return false;
  const timestamp = Date.parse(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && timestamp < now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Best-effort local journal for write lifecycle events. It intentionally never
 * receives credentials, request payloads, addresses, or OpenAPI responses.
 */
export class FileAuditLogger implements AuditLogger {
  public constructor(
    private readonly directory = auditDirectory(),
    private readonly now = () => new Date(),
    private readonly os: NodeJS.Platform = platform()
  ) {}

  public async record(entry: AuditRecord): Promise<void> {
    try {
      const now = this.now();
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (this.os !== "win32") await chmod(this.directory, 0o700);
      await this.removeExpired(now);
      const file = join(this.directory, `audit-${dateKey(now)}.jsonl`);
      await appendFile(file, `${JSON.stringify({ timestamp: now.toISOString(), ...entry })}\n`, { encoding: "utf8", mode: 0o600 });
      if (this.os !== "win32") await chmod(file, 0o600);
    } catch {
      // Audit persistence must not block or duplicate a real financial request.
    }
  }

  private async removeExpired(now: Date): Promise<void> {
    try {
      const files = await readdir(this.directory);
      await Promise.all(files.filter((file) => olderThanRetention(file, now)).map((file) => rm(join(this.directory, file), { force: true })));
    } catch {
      // The next write can still proceed safely when a stale log cannot be removed.
    }
  }
}
