import { createHash } from "node:crypto";
import { AiHubError } from "./errors.js";

export interface ApiCredentials {
  apiKey: string;
  secretKey: string;
}

export interface LoadedCredentials extends ApiCredentials {
  credentialVersion: string;
}

export function validateApiCredentials(credentials: ApiCredentials): ApiCredentials {
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

/** Load a complete credential pair stored in the selected local TOML profile. */
export function loadStoredCredentials(apiKey?: string, secretKey?: string): LoadedCredentials | undefined {
  if (apiKey === undefined && secretKey === undefined) return undefined;
  const credentials = validateApiCredentials({ apiKey: apiKey ?? "", secretKey: secretKey ?? "" });
  return { ...credentials, credentialVersion: versionOf(credentials) };
}
