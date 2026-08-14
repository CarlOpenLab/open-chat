import { computed, ref, watch } from "vue";
import {
  aiService,
  type LocalModelInfo,
  type ModelsProvider,
  type LocalModelsInfo,
} from "../services/ai";
import { providerService, type StoredLocalProvider } from "../services/providers";

/** 模型下拉数据：按供应商分组的模型列表。 */
export interface ModelCatalogEntry {
  providerId: string;
  providerName: string;
  models: { id: string; name: string; contextLength?: number }[];
}

/**
 * 模型加载与选择：
 * - 本地 AI（服务端 opencode 发现的 `provider/model`）优先展示；
 * - 手动配置的服务商数据仍在浏览器本地（IndexedDB）；
 * 两者合并成按供应商分组的模型目录，按当前模型解析转发目标（本地模型无需 baseUrl/apiKey，
 * 直接走服务端本地 provider；手动配置的模型随请求体带 provider 交给代理）。
 */
export function useChatModels() {
  const models = ref<ModelsProvider[]>([]);
  const defaultModelId = ref("");
  const currentModel = ref("");
  const storedProviders = ref<StoredLocalProvider[]>([]);
  const localInfo = ref<LocalModelsInfo | null>(null);

  /** 本地模型 id 集合（服务端 opencode 发现）。 */
  const localModelIds = computed(
    () => new Set((localInfo.value?.models ?? []).map((model) => model.id)),
  );

  /** 当前模型是否走本地 opencode（无需转发目标）。 */
  function isLocalModel(model: string): boolean {
    return localModelIds.value.has(model);
  }

  const allModelIds = computed(() =>
    models.value.flatMap((provider) => provider.models.map((model) => model.id)),
  );

  const modelById = computed<Record<string, { id: string; name: string; provider: string }>>(() => {
    const map: Record<string, { id: string; name: string; provider: string }> = {};
    for (const provider of models.value) {
      for (const model of provider.models) {
        map[model.id] = {
          id: model.id,
          name: model.name || model.id,
          provider: provider.name,
        };
      }
    }
    return map;
  });

  /** 本地模型按 provider 分组（opencode / opencode-go 各成一组）。 */
  const groupLocalModels = (list: LocalModelInfo[]): ModelsProvider[] => {
    const byProvider = new Map<string, ModelsProvider>();
    for (const model of list) {
      const providerId = model.provider || "opencode";
      const providerName = model.providerName || providerId;
      let entry = byProvider.get(providerId);
      if (!entry) {
        entry = { name: providerName, models: [] };
        byProvider.set(providerId, entry);
      }
      entry.models.push({
        id: model.id,
        name: model.name || model.id,
        contextLength: model.contextLength,
      });
    }
    return Array.from(byProvider.values());
  };

  const currentModelLabel = computed(
    () => modelById.value[currentModel.value]?.name || currentModel.value || "选择模型",
  );

  function reconcileCurrentModel() {
    if (allModelIds.value.length === 0) return;
    if (!currentModel.value || !allModelIds.value.includes(currentModel.value)) {
      currentModel.value = allModelIds.value.includes(defaultModelId.value)
        ? defaultModelId.value
        : allModelIds.value[0];
    }
  }

  /**
   * 当前模型对应的转发目标（无状态代理需要每次请求携带）。
   * 本地模型（opencode/...）返回 undefined（走服务端本地 provider）；
   * 手动配置的模型从本地服务商数据同步查找，找不到返回 undefined。
   */
  function getForwardProvider(
    model: string,
  ): { baseUrl: string; apiKey: string; api: "chat/completions" | "responses" } | undefined {
    if (isLocalModel(model)) return undefined;
    const provider = storedProviders.value.find((item) => item.models.some((m) => m.id === model));
    if (!provider) return undefined;
    return { baseUrl: provider.baseUrl, apiKey: provider.apiKey, api: provider.api };
  }

  const loadModels = async () => {
    try {
      const [providers, modelsResp] = await Promise.all([
        providerService.list(),
        aiService.getModels().catch(() => null),
      ]);
      storedProviders.value = await providerService.listStored();
      localInfo.value = modelsResp?.local ?? null;

      // 本地 opencode 发现的模型（服务端，AI 取本地的）优先展示，按 provider 分组。
      const localModels: ModelsProvider[] = groupLocalModels(localInfo.value?.models ?? []);

      models.value = [
        ...localModels,
        ...providers.map((provider) => ({
          name: provider.name,
          models: provider.models,
        })),
      ];
      defaultModelId.value = localModels[0]?.models[0]?.id ?? providers[0]?.models[0]?.id ?? "";
      reconcileCurrentModel();
    } catch (e) {
      console.error("Failed to load models:", e);
    }
  };

  watch(models, () => reconcileCurrentModel());

  /** 模型目录：本地 opencode + 手动配置的服务商合并，按 provider 分组。 */
  const modelCatalog = computed<ModelCatalogEntry[]>(() => {
    const entries = new Map<string, ModelCatalogEntry>();
    const entryFor = (providerId: string, providerName: string): ModelCatalogEntry => {
      let entry = entries.get(providerId);
      if (!entry) {
        entry = { providerId, providerName, models: [] };
        entries.set(providerId, entry);
      }
      if (providerName) entry.providerName = providerName;
      return entry;
    };
    for (const model of localInfo.value?.models ?? []) {
      const providerId = model.provider || "opencode";
      const entry = entryFor(providerId, model.providerName || providerId);
      entry.models.push({
        id: model.id,
        name: model.name || model.id,
        contextLength: model.contextLength,
      });
    }
    for (const provider of storedProviders.value) {
      if (!provider.models.length) continue;
      const entry = entryFor(provider.name, provider.name);
      for (const model of provider.models) {
        entry.models.push({
          id: model.id,
          name: model.name || model.id,
          contextLength: model.contextLength,
        });
      }
    }
    return Array.from(entries.values()).filter((entry) => entry.models.length > 0);
  });

  return {
    models,
    defaultModelId,
    currentModel,
    storedProviders,
    localInfo,
    localModelIds,
    allModelIds,
    modelById,
    modelCatalog,
    currentModelLabel,
    reconcileCurrentModel,
    getForwardProvider,
    isLocalModel,
    loadModels,
  };
}
