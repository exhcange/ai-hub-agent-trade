import { ConfigStore } from "../config.js";
import { AiHubSpotApi, type ApiClientOptions } from "../openapi.js";
import { AiHubError } from "../errors.js";
import type { ExecutionContext } from "../confirmation.js";
import type { ToolExecutionContext } from "./tool-spec.js";

/** Loads one isolated local SaaS profile for one CLI command or MCP Tool call. */
export async function createToolExecutionContext(profileName?: string, apiOptions?: ApiClientOptions): Promise<ToolExecutionContext> {
  const store = new ConfigStore();
  const profile = await store.showProfile(profileName);
  const credentials = await store.getCredentials(profile.name);
  return { profile, credentials, api: new AiHubSpotApi(profile.openApiBaseUrl, apiOptions) };
}

export function confirmationContext(context: ToolExecutionContext): ExecutionContext {
  if (!context.credentials) throw new AiHubError("AI_HUB_CREDENTIAL_NOT_CONFIGURED", `Credentials are not configured for profile "${context.profile.name}".`);
  return {
    profile: context.profile.name,
    openApiBaseUrl: context.profile.openApiBaseUrl,
    configVersion: context.profile.configVersion,
    credentialVersion: context.credentials.credentialVersion
  };
}
