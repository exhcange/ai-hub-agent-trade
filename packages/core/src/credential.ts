import { createHash } from "node:crypto";
import keytar from "keytar";
import { AiHubError } from "./errors.js";

export interface ApiCredentials {
  apiKey: string;
  secretKey: string;
}

export interface LoadedCredentials extends ApiCredentials {
  credentialVersion: string;
}

const SERVICE_NAME = "ai-hub-agent-trade";

function validate(credentials: ApiCredentials): ApiCredentials {
  const apiKey = credentials.apiKey.trim();
  const secretKey = credentials.secretKey.trim();
  if (!apiKey || !secretKey) {
    throw new AiHubError("AI_HUB_INVALID_CREDENTIAL", "API key and secret key must both be present.");
  }
  return { apiKey, secretKey };
}

function versionOf(credentials: ApiCredentials): string {
  return createHash("sha256").update(`${credentials.apiKey}\u0000${credentials.secretKey}`).digest("hex");
}

/**
 * Uses macOS Keychain, Windows Credential Manager, or the Linux Secret Service
 * through the native keytar adapter. Credentials are never written to TOML.
 */
export class CredentialStore {
  public async set(profile: string, credentials: ApiCredentials): Promise<{ credentialRef: string; credentialVersion: string }> {
    const value = validate(credentials);
    await keytar.setPassword(SERVICE_NAME, profile, JSON.stringify(value));
    return { credentialRef: `keychain:${SERVICE_NAME}/${profile}`, credentialVersion: versionOf(value) };
  }

  public async get(profile: string): Promise<LoadedCredentials | undefined> {
    const stored = await keytar.getPassword(SERVICE_NAME, profile);
    if (!stored) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new AiHubError("AI_HUB_CREDENTIAL_INVALID", "Stored credentials are unreadable. Set credentials again.");
    }
    const credentials = validate(parsed as ApiCredentials);
    return { ...credentials, credentialVersion: versionOf(credentials) };
  }

  public async remove(profile: string): Promise<boolean> {
    return keytar.deletePassword(SERVICE_NAME, profile);
  }
}
