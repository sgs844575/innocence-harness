export interface ServerAuthorizationConfig {
  clientId?: string;
  callbackPort?: number;
  authServerMetadataUrl?: string;
  scopes?: string[];
}
export function parseServerAuthorizationConfig(value: unknown, allowUnresolvedVariables = false): ServerAuthorizationConfig | undefined {
  if (value === undefined || value === true) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid server authorization configuration.");
  const config = value as Record<string, unknown>;
  for (const key of Object.keys(config)) if (!["clientId", "callbackPort", "authServerMetadataUrl", "scopes"].includes(key)) throw new Error(`Unsupported authorization option: ${key}`);
  for (const key of ["clientId", "authServerMetadataUrl"]) if (config[key] !== undefined && (typeof config[key] !== "string" || !config[key].trim())) throw new Error(`Invalid authorization ${key}.`);
  if (config.callbackPort !== undefined && (!Number.isInteger(config.callbackPort) || Number(config.callbackPort) < 1 || Number(config.callbackPort) > 65535)) throw new Error("Invalid authorization callback port.");
  if (config.scopes !== undefined && (!Array.isArray(config.scopes) || config.scopes.some((scope) => typeof scope !== "string" || !scope.trim()))) throw new Error("Invalid authorization scopes.");
  if (typeof config.authServerMetadataUrl === "string" && !(allowUnresolvedVariables && /\$\{[^}]+\}/.test(config.authServerMetadataUrl))) {
    const url = new URL(config.authServerMetadataUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Authorization metadata URL must use HTTPS without credentials or a fragment.");
  }
  return config as ServerAuthorizationConfig;
}
