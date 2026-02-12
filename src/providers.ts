/**
 * Model and provider definitions.
 *
 * All providers use the OpenAI SDK via compatible endpoints.
 * To add a new provider, add an entry here with its baseURL
 * and API key env var name, and any models it supports.
 */

export interface ModelDetails {
  id: string;
  name: string;
  contextWindow: number;
  pricingPerMillionInput: number;
  pricingPerMillionOutput: number;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseURL?: string;          // OpenAI-compatible endpoint (undefined = default OpenAI)
  apiKeyEnvVar: string;      // Environment variable name for fallback
  models: ModelDetails[];
}

export const SUPPORTED_MODELS: ModelProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    models: [
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        contextWindow: 128_000,
        pricingPerMillionInput: 0.15,
        pricingPerMillionOutput: 0.60,
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextWindow: 128_000,
        pricingPerMillionInput: 2.50,
        pricingPerMillionOutput: 10.00,
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        contextWindow: 200_000,
        pricingPerMillionInput: 1.10,
        pricingPerMillionOutput: 4.40,
      },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    models: [
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        contextWindow: 1_000_000,
        pricingPerMillionInput: 0.15,
        pricingPerMillionOutput: 0.60,
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        contextWindow: 1_000_000,
        pricingPerMillionInput: 1.25,
        pricingPerMillionOutput: 10.00,
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1/',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        contextWindow: 200_000,
        pricingPerMillionInput: 3.00,
        pricingPerMillionOutput: 15.00,
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        contextWindow: 200_000,
        pricingPerMillionInput: 0.80,
        pricingPerMillionOutput: 4.00,
      },
    ],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    apiKeyEnvVar: 'CEREBRAS_API_KEY',
    models: [
      {
        id: 'llama-4-scout-17b-16e-instruct',
        name: 'Llama 4 Scout 17B',
        contextWindow: 128_000,
        pricingPerMillionInput: 0.00,
        pricingPerMillionOutput: 0.00,
      },
    ],
  },
];

/** Find a provider by ID. */
export function getProvider(providerId: string): ModelProvider | undefined {
  return SUPPORTED_MODELS.find((p) => p.id === providerId);
}

/** Find a model's details by provider and model ID. */
export function getModelDetails(providerId: string, modelId: string): ModelDetails | undefined {
  const provider = getProvider(providerId);
  return provider?.models.find((m) => m.id === modelId);
}

/** Get model pricing in per-token format (for cost-tracker). */
export function getModelPricing(providerId: string, modelId: string) {
  const details = getModelDetails(providerId, modelId);
  if (!details) return undefined;
  return {
    inputPerToken: details.pricingPerMillionInput / 1_000_000,
    outputPerToken: details.pricingPerMillionOutput / 1_000_000,
    contextWindow: details.contextWindow,
  };
}
