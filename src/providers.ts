/**
 * Provider and model registry.
 *
 * Built-in providers are declared in source and merged with runtime overrides
 * from `protoagent.jsonc`.
 */

import { getRuntimeConfig } from './runtime-config.js';

export interface ModelDetails {
  id: string;
  name: string;
  contextWindow: number;
  pricingPerMillionInput: number;
  pricingPerMillionOutput: number;
  pricingPerMillionCached?: number;
  defaultParams?: Record<string, unknown>;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  models: ModelDetails[];
}

export const BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 1_048_576, pricingPerMillionInput: 2.50, pricingPerMillionOutput: 15.00 },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', contextWindow: 1_000_000, pricingPerMillionInput: 0.25, pricingPerMillionOutput: 2.00 },
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1_048_576, pricingPerMillionInput: 2.0, pricingPerMillionOutput: 8.00 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1/',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 200_000, pricingPerMillionInput: 5.0, pricingPerMillionOutput: 25.0 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200_000, pricingPerMillionInput: 3.0, pricingPerMillionOutput: 15.0 },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200_000, pricingPerMillionInput: 1.0, pricingPerMillionOutput: 5.0 },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', contextWindow: 1_000_000, pricingPerMillionInput: 0.50, pricingPerMillionOutput: 3.0 },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', contextWindow: 1_000_000, pricingPerMillionInput: 2.0, pricingPerMillionOutput: 12.0 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_000_000, pricingPerMillionInput: 0.30, pricingPerMillionOutput: 2.5 },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1_000_000, pricingPerMillionInput: 1.25, pricingPerMillionOutput: 10.0 },
    ],
  },
];

function sanitizeDefaultParams(defaultParams?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!defaultParams || Object.keys(defaultParams).length === 0) return undefined;
  return defaultParams;
}

function toProviderMap(providers: ModelProvider[]): Map<string, ModelProvider> {
  return new Map(providers.map((provider) => [provider.id, provider]));
}

function mergeModelLists(baseModels: ModelDetails[], overrideModels?: Record<string, any>): ModelDetails[] {
  const merged = new Map(baseModels.map((model) => [model.id, model]));
  for (const [modelId, override] of Object.entries(overrideModels || {})) {
    const current = merged.get(modelId);
    merged.set(modelId, {
      id: modelId,
      name: override.name ?? current?.name ?? modelId,
      contextWindow: override.contextWindow ?? current?.contextWindow ?? 0,
      pricingPerMillionInput: override.inputPricePerMillion ?? current?.pricingPerMillionInput ?? 0,
      pricingPerMillionOutput: override.outputPricePerMillion ?? current?.pricingPerMillionOutput ?? 0,
      pricingPerMillionCached: override.cachedPricePerMillion ?? current?.pricingPerMillionCached,
      defaultParams: sanitizeDefaultParams({
        ...(current?.defaultParams || {}),
        ...(override.defaultParams || {}),
      }),
    });
  }
  return Array.from(merged.values());
}

export function getAllProviders(): ModelProvider[] {
  const runtimeProviders = getRuntimeConfig().providers || {};
  const mergedProviders = toProviderMap(BUILTIN_PROVIDERS);

  for (const [providerId, providerConfig] of Object.entries(runtimeProviders)) {
    const current = mergedProviders.get(providerId);
    mergedProviders.set(providerId, {
      id: providerId,
      name: providerConfig.name ?? current?.name ?? providerId,
      baseURL: providerConfig.baseURL ?? current?.baseURL,
      apiKey: providerConfig.apiKey ?? current?.apiKey,
      apiKeyEnvVar: providerConfig.apiKeyEnvVar ?? current?.apiKeyEnvVar,
      headers: providerConfig.headers ?? current?.headers,
      defaultParams: sanitizeDefaultParams({
        ...(current?.defaultParams || {}),
        ...(providerConfig.defaultParams || {}),
      }),
      models: mergeModelLists(current?.models || [], providerConfig.models),
    });
  }

  return Array.from(mergedProviders.values());
}

export function getProvider(providerId: string): ModelProvider | undefined {
  return getAllProviders().find((provider) => provider.id === providerId);
}

export function getModelDetails(providerId: string, modelId: string): ModelDetails | undefined {
  return getProvider(providerId)?.models.find((model) => model.id === modelId);
}

export function getModelPricing(providerId: string, modelId: string) {
  const details = getModelDetails(providerId, modelId);
  if (!details) return undefined;
  return {
    inputPerToken: details.pricingPerMillionInput / 1_000_000,
    outputPerToken: details.pricingPerMillionOutput / 1_000_000,
    cachedPerToken: details.pricingPerMillionCached != null ? details.pricingPerMillionCached / 1_000_000 : undefined,
    contextWindow: details.contextWindow,
  };
}

export function getRequestDefaultParams(providerId: string, modelId: string): Record<string, unknown> {
  const provider = getProvider(providerId);
  const model = getModelDetails(providerId, modelId);
  return {
    ...(provider?.defaultParams || {}),
    ...(model?.defaultParams || {}),
  };
}
