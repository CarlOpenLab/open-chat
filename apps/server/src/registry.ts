/**
 * Provider registry mapping each configured model id to its provider.
 *
 * Mirrors `rust-chat/src/gateway/router.rs`.
 */
import type { AppConfig } from "./config";
import { GatewayError } from "./error";
import { OpenAiCompatibleProvider } from "./provider";

export interface ProviderRoute {
  model: string;
  provider: OpenAiCompatibleProvider;
}

export class ProviderRegistry {
  private readonly defaultModel: string;
  private readonly providersByModel: Map<string, OpenAiCompatibleProvider>;

  readonly providers: OpenAiCompatibleProvider[];

  private constructor(
    defaultModel: string,
    providersByModel: Map<string, OpenAiCompatibleProvider>,
    providers: OpenAiCompatibleProvider[],
  ) {
    this.defaultModel = defaultModel;
    this.providersByModel = providersByModel;
    this.providers = providers;
  }

  static fromConfig(config: AppConfig): ProviderRegistry {
    const providersByModel = new Map<string, OpenAiCompatibleProvider>();
    const providers: OpenAiCompatibleProvider[] = [];

    for (const providerConfig of config.providers) {
      const provider = new OpenAiCompatibleProvider(
        providerConfig.name,
        providerConfig.baseUrl,
        providerConfig.apiKey,
      );
      providers.push(provider);

      for (const model of providerConfig.models) {
        if (providersByModel.has(model.id)) {
          throw GatewayError.invalidRequest(`Model is configured more than once: ${model.id}`);
        }
        providersByModel.set(model.id, provider);
      }
    }

    return new ProviderRegistry(config.defaultModel, providersByModel, providers);
  }

  resolveModel(model?: string): ProviderRoute {
    const resolved = model ?? this.defaultModel;
    const provider = this.providersByModel.get(resolved);
    if (!provider) {
      throw GatewayError.unsupportedModel(resolved);
    }
    return { model: resolved, provider };
  }
}
