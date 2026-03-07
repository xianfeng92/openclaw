import { ProxyAgent, type Dispatcher } from "undici";
import type { CyDeckRuntimeProviderConfig } from "./cydeck-config.js";

const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const ANTHROPIC_DEFAULT_MODEL = "claude-3-5-haiku-latest";
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const GOOGLE_DEFAULT_MODEL = "gemini-2.0-flash";
const GOOGLE_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

type RequestInitWithDispatcher = RequestInit & { dispatcher?: Dispatcher };

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export interface AIProvider {
  chat(
    messages: ChatMessage[],
    onChunk?: (text: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<string>;
}

function shouldBypassProxy(hostname: string, noProxyRaw?: string): boolean {
  if (!noProxyRaw || !noProxyRaw.trim()) {
    return false;
  }

  const host = hostname.trim().toLowerCase();
  const rules = noProxyRaw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  for (const rule of rules) {
    if (rule === "*") {
      return true;
    }
    const normalizedRule = rule.startsWith(".") ? rule.slice(1) : rule;
    if (host === normalizedRule || host.endsWith(`.${normalizedRule}`)) {
      return true;
    }
  }

  return false;
}

function createProxyDispatcher(baseUrl: string): Dispatcher | undefined {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return undefined;
  }

  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassProxy(parsed.hostname, noProxy)) {
    return undefined;
  }

  const proxyUrl =
    (parsed.protocol === "https:" ? process.env.HTTPS_PROXY || process.env.https_proxy : "") ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (!proxyUrl || !proxyUrl.trim()) {
    return undefined;
  }

  try {
    return new ProxyAgent(proxyUrl.trim());
  } catch {
    return undefined;
  }
}

export function formatProviderError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }

  const withCause = err as Error & { cause?: unknown };
  const cause = withCause.cause;

  if (cause instanceof Error && cause.message) {
    return `${err.message} (${cause.message})`;
  }

  if (cause && typeof cause === "object") {
    const causeRecord = cause as Record<string, unknown>;
    if (typeof causeRecord.message === "string" && causeRecord.message.trim()) {
      return `${err.message} (${causeRecord.message})`;
    }
  }

  return err.message;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

class OpenAIProvider implements AIProvider {
  private readonly dispatcher: Dispatcher | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {
    this.dispatcher = createProxyDispatcher(baseUrl);
  }

  async chat(
    messages: ChatMessage[],
    onChunk?: (text: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<string> {
    const requestInit: RequestInitWithDispatcher = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: Boolean(onChunk),
      }),
      signal,
    };
    if (this.dispatcher) {
      requestInit.dispatcher = this.dispatcher;
    }

    const response = await fetch(`${normalizeBaseUrl(this.baseUrl)}/chat/completions`, requestInit);

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status} ${response.statusText}`);
    }

    if (!onChunk) {
      const data = (await response.json()) as Record<string, unknown>;
      return this.extractFullText(data);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("AI API returned an empty response body");
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const lineBreakIndex = buffer.indexOf("\n");
        if (lineBreakIndex === -1) {
          break;
        }

        const line = buffer.slice(0, lineBreakIndex).trim();
        buffer = buffer.slice(lineBreakIndex + 1);

        if (!line.startsWith("data:")) {
          continue;
        }

        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") {
          continue;
        }

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const delta = this.extractDeltaText(parsed);
          if (delta) {
            fullText += delta;
            await onChunk(delta);
          }
        } catch {
          // Ignore malformed chunks from upstream provider.
        }
      }
    }

    return fullText;
  }

  private extractFullText(data: Record<string, unknown>): string {
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    if (!first || typeof first !== "object") {
      return "";
    }

    const message = first.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") {
      return "";
    }

    const content = message.content;
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? text : "";
        })
        .join("");
    }

    return "";
  }

  private extractDeltaText(data: Record<string, unknown>): string {
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    if (!first || typeof first !== "object") {
      return "";
    }

    const delta = first.delta as Record<string, unknown> | undefined;
    if (!delta || typeof delta !== "object") {
      return "";
    }

    const content = delta.content;
    return typeof content === "string" ? content : "";
  }
}

class AnthropicProvider implements AIProvider {
  private readonly dispatcher: Dispatcher | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly maxTokens: number,
  ) {
    this.dispatcher = createProxyDispatcher(baseUrl);
  }

  async chat(
    messages: ChatMessage[],
    onChunk?: (text: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<string> {
    const systemPrompt = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join("\n\n");

    const conversation = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      }));

    const payload: Record<string, unknown> = {
      model: this.model,
      max_tokens: Math.max(1, Math.floor(this.maxTokens)),
      messages: conversation,
    };
    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    const requestInit: RequestInitWithDispatcher = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
      signal,
    };
    if (this.dispatcher) {
      requestInit.dispatcher = this.dispatcher;
    }

    const response = await fetch(`${normalizeBaseUrl(this.baseUrl)}/messages`, requestInit);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const detail = errorText ? ` - ${errorText}` : "";
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}${detail}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const text = this.extractText(data);
    if (onChunk && text) {
      await onChunk(text);
    }
    return text;
  }

  private extractText(data: Record<string, unknown>): string {
    const content = Array.isArray(data.content) ? data.content : [];
    return content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const record = part as Record<string, unknown>;
        if (record.type !== "text") {
          return "";
        }
        return typeof record.text === "string" ? record.text : "";
      })
      .join("");
  }
}

class GoogleProvider implements AIProvider {
  private readonly dispatcher: Dispatcher | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly maxTokens: number,
  ) {
    this.dispatcher = createProxyDispatcher(baseUrl);
  }

  async chat(
    messages: ChatMessage[],
    onChunk?: (text: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<string> {
    const systemMessages = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content.trim())
      .filter(Boolean);

    const contents = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

    const endpoint = this.buildEndpoint();
    const payload: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: Math.max(1, Math.floor(this.maxTokens)),
      },
    };
    if (systemMessages.length > 0) {
      payload.systemInstruction = {
        parts: [{ text: systemMessages.join("\n\n") }],
      };
    }

    const requestInit: RequestInitWithDispatcher = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    };
    if (this.dispatcher) {
      requestInit.dispatcher = this.dispatcher;
    }

    const response = await fetch(endpoint, requestInit);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const detail = errorText ? ` - ${errorText}` : "";
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}${detail}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const text = this.extractText(data);
    if (onChunk && text) {
      await onChunk(text);
    }
    return text;
  }

  private buildEndpoint(): string {
    const normalizedBase = normalizeBaseUrl(this.baseUrl);
    const encodedModel = encodeURIComponent(this.model);
    const encodedKey = encodeURIComponent(this.apiKey);
    return `${normalizedBase}/models/${encodedModel}:generateContent?key=${encodedKey}`;
  }

  private extractText(data: Record<string, unknown>): string {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const first = candidates[0] as Record<string, unknown> | undefined;
    if (!first || typeof first !== "object") {
      return "";
    }

    const content = first.content as Record<string, unknown> | undefined;
    if (!content || typeof content !== "object") {
      return "";
    }

    const parts = Array.isArray(content.parts) ? content.parts : [];
    return parts
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const text = (part as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
}

export function createEmbeddedGatewayProvider(
  runtimeProvider?: CyDeckRuntimeProviderConfig,
): { provider: AIProvider | null; unavailableReason: string } {
  if (runtimeProvider) {
    const apiKey = runtimeProvider.apiKey.trim();
    if (!apiKey) {
      return {
        provider: null,
        unavailableReason: `Provider "${runtimeProvider.provider}" is selected but apiKey is empty.`,
      };
    }

    if (runtimeProvider.provider === "openai") {
      const baseUrl = runtimeProvider.baseUrl.trim() || OPENAI_DEFAULT_BASE_URL;
      const model = runtimeProvider.model.trim() || OPENAI_DEFAULT_MODEL;
      return {
        provider: new OpenAIProvider(apiKey, baseUrl, model),
        unavailableReason: "",
      };
    }

    if (runtimeProvider.provider === "anthropic") {
      const baseUrl = runtimeProvider.baseUrl.trim() || ANTHROPIC_DEFAULT_BASE_URL;
      const model = runtimeProvider.model.trim() || ANTHROPIC_DEFAULT_MODEL;
      return {
        provider: new AnthropicProvider(apiKey, baseUrl, model, runtimeProvider.maxTokens),
        unavailableReason: "",
      };
    }

    if (runtimeProvider.provider === "google") {
      const baseUrl = runtimeProvider.baseUrl.trim() || GOOGLE_DEFAULT_BASE_URL;
      const model = runtimeProvider.model.trim() || GOOGLE_DEFAULT_MODEL;
      return {
        provider: new GoogleProvider(apiKey, baseUrl, model, runtimeProvider.maxTokens),
        unavailableReason: "",
      };
    }

    return {
      provider: null,
      unavailableReason: `Provider "${runtimeProvider.provider}" is not supported by Embedded Gateway yet.`,
    };
  }

  const envOpenAiApiKey = (process.env.OPENAI_API_KEY || "").trim();
  const envOpenAiBaseUrl =
    (process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL).trim() || OPENAI_DEFAULT_BASE_URL;
  const envOpenAiModel = (process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL).trim() || OPENAI_DEFAULT_MODEL;
  if (envOpenAiApiKey) {
    return {
      provider: new OpenAIProvider(envOpenAiApiKey, envOpenAiBaseUrl, envOpenAiModel),
      unavailableReason: "",
    };
  }

  const envAnthropicApiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const envAnthropicBaseUrl =
    (process.env.ANTHROPIC_BASE_URL || ANTHROPIC_DEFAULT_BASE_URL).trim() ||
    ANTHROPIC_DEFAULT_BASE_URL;
  const envAnthropicModel =
    (process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL).trim() || ANTHROPIC_DEFAULT_MODEL;
  if (envAnthropicApiKey) {
    return {
      provider: new AnthropicProvider(envAnthropicApiKey, envAnthropicBaseUrl, envAnthropicModel, 4096),
      unavailableReason: "",
    };
  }

  const envGeminiApiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  const envGeminiBaseUrl =
    (process.env.GEMINI_BASE_URL || GOOGLE_DEFAULT_BASE_URL).trim() || GOOGLE_DEFAULT_BASE_URL;
  const envGeminiModel = (process.env.GEMINI_MODEL || GOOGLE_DEFAULT_MODEL).trim() || GOOGLE_DEFAULT_MODEL;
  if (envGeminiApiKey) {
    return {
      provider: new GoogleProvider(envGeminiApiKey, envGeminiBaseUrl, envGeminiModel, 8192),
      unavailableReason: "",
    };
  }

  return {
    provider: null,
    unavailableReason:
      "AI chat is not configured. Set CyDeck config ai provider apiKey or OPENAI_API_KEY/ANTHROPIC_API_KEY/GEMINI_API_KEY.",
  };
}
