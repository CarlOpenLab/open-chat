import type { MenuProps } from "antdv-next";
import { computed, ref, watch } from "vue";
import { aiService, type ModelsProvider } from "../services/ai";
import { providerService, type StoredLocalProvider } from "../services/providers";

/**
 * 模型加载与选择：服务商数据存储在浏览器本地（IndexedDB），
 * 这里负责拉取本地服务商生成模型下拉、拉取服务端搜索能力状态，并
 * 按当前模型解析转发目标（baseUrl / apiKey / api，随请求体交给代理）。
 */
export function useChatModels() {
  const models = ref<ModelsProvider[]>([]);
  const defaultModelId = ref("");
  const currentModel = ref("");
  const searchAvailable = ref(false);
  const storedProviders = ref<StoredLocalProvider[]>([]);

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

  const modelOptions = computed(() =>
    models.value.flatMap((provider) =>
      provider.models.map((model) => ({
        label: model.name || model.id,
        value: model.id,
      })),
    ),
  );

  const modelDropdownItems = computed<MenuProps["items"]>(() => {
    return modelOptions.value.map((opt) => ({
      key: opt.value,
      label: opt.label,
    }));
  });

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
   * 从本地服务商数据同步查找，找不到返回 undefined。
   */
  function getForwardProvider(
    model: string,
  ): { baseUrl: string; apiKey: string; api: "chat/completions" | "responses" } | undefined {
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
      models.value = providers.map((provider) => ({
        name: provider.name,
        models: provider.models,
      }));
      defaultModelId.value = providers[0]?.models[0]?.id ?? "";
      searchAvailable.value = !!modelsResp?.search?.enabled;
      reconcileCurrentModel();
    } catch (e) {
      console.error("Failed to load models:", e);
    }
  };

  watch(models, () => reconcileCurrentModel());

  return {
    models,
    defaultModelId,
    currentModel,
    searchAvailable,
    storedProviders,
    allModelIds,
    modelById,
    modelOptions,
    modelDropdownItems,
    currentModelLabel,
    reconcileCurrentModel,
    getForwardProvider,
    loadModels,
  };
}
