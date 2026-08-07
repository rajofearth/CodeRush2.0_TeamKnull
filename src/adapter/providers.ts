/**
 * Pluggable AI SDK providers.
 * Add a new entry here + optionalDependency/dependency — resolveModel stays unchanged.
 */

export type ProviderId = "cerebras" | "openai" | "anthropic";

/** Opaque AI SDK language model (provider packages return LanguageModelV1). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLanguageModel = any;

export type ProviderHandle = {
  id: ProviderId;
  model: AnyLanguageModel;
  modelId: string;
};

type ProviderDef = {
  id: ProviderId;
  /** Env var that holds the API key */
  envKey: string;
  /** Default model when CLAI_MODEL is unset */
  defaultModel: string;
  /** Lazy-load the AI SDK provider factory */
  create: (apiKey: string, modelId: string) => Promise<AnyLanguageModel>;
};

const PROVIDERS: Record<ProviderId, ProviderDef> = {
  cerebras: {
    id: "cerebras",
    envKey: "CEREBRAS_API_KEY",
    defaultModel: "llama-3.3-70b",
    create: async (apiKey, modelId) => {
      const { createCerebras } = await import("@ai-sdk/cerebras");
      return createCerebras({ apiKey })(modelId);
    },
  },
  openai: {
    id: "openai",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    create: async (apiKey, modelId) => {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey })(modelId);
    },
  },
  anthropic: {
    id: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-20250514",
    create: async (apiKey, modelId) => {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey })(modelId);
    },
  },
};

/** Default provider for hackathon — override with CLAI_PROVIDER. */
export const DEFAULT_PROVIDER: ProviderId = "cerebras";

export function listProviders(): ProviderId[] {
  return Object.keys(PROVIDERS) as ProviderId[];
}

export function providerEnvKey(id: ProviderId): string {
  return PROVIDERS[id].envKey;
}

export function hasAnyProviderKey(): boolean {
  return listProviders().some((id) => Boolean(process.env[PROVIDERS[id].envKey]));
}

export function hasProviderKey(id: ProviderId): boolean {
  return Boolean(process.env[PROVIDERS[id].envKey]);
}

/**
 * Pick provider: explicit prefer → CLAI_PROVIDER → DEFAULT if keyed → first available.
 */
export function pickProviderId(prefer?: ProviderId): ProviderId {
  const fromEnv = process.env.CLAI_PROVIDER as ProviderId | undefined;
  const order: ProviderId[] = [];
  if (prefer) order.push(prefer);
  if (fromEnv && PROVIDERS[fromEnv]) order.push(fromEnv);
  order.push(DEFAULT_PROVIDER);
  for (const id of listProviders()) {
    if (!order.includes(id)) order.push(id);
  }
  for (const id of order) {
    if (hasProviderKey(id)) return id;
  }
  throw new Error(
    `No API key found. Set one of: ${listProviders()
      .map((id) => PROVIDERS[id].envKey)
      .join(", ")}. Or run \`clai demo\` offline.`,
  );
}

export async function createProviderHandle(
  prefer?: ProviderId,
  modelIdOverride?: string,
): Promise<ProviderHandle> {
  const id = pickProviderId(prefer);
  const def = PROVIDERS[id];
  const apiKey = process.env[def.envKey];
  if (!apiKey) {
    throw new Error(`Missing ${def.envKey} for provider ${id}`);
  }
  const modelId =
    modelIdOverride ?? process.env.CLAI_MODEL ?? def.defaultModel;
  const model = await def.create(apiKey, modelId);
  return { id, model, modelId };
}
