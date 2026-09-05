export type ApiFormat = "chat-completions" | "messages" | "responses" | "native-generative";

export function normalizeApiFormat(value: unknown): ApiFormat | undefined {
  return value === "chat-completions" || value === "messages" || value === "responses" || value === "native-generative"
    ? value : undefined;
}

export function apiFormatKind<T extends "openai" | "anthropic" | "google">(profile: { kind: T; apiFormat?: ApiFormat }): T | "openai" | "anthropic" | "google" {
  switch (profile.apiFormat) {
    case "messages": return "anthropic";
    case "native-generative": return "google";
    case "chat-completions":
    case "responses": return "openai";
    default: return profile.kind;
  }
}
