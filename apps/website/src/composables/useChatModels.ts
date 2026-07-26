import type { MenuProps } from "antdv-next";
import { computed, ref, watch } from "vue";
import { aiService, type ModelsProvider } from "../services/ai";

/**
 * 模型加载与选择：负责模型列表拉取、下拉选项生成与当前模型的校准。
 */
export function useChatModels() {
  const models = ref<ModelsProvider[]>([]);
  const defaultModelId = ref("");
  const currentModel = ref("");
  const searchAvailable = ref(false);

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
      // Only trust defaultModelId when it actually maps to a configured model;
      // otherwise fall back to the first available model so a stale or mistyped
      // `default_model` in providers.toml can't silently break every request.
      currentModel.value = allModelIds.value.includes(defaultModelId.value)
        ? defaultModelId.value
        : allModelIds.value[0];
    }
  }

  const loadModels = async () => {
    try {
      const data = await aiService.getModels();
      models.value = data.providers;
      defaultModelId.value = data.defaultModel;
      searchAvailable.value = !!data.search?.enabled;
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
    allModelIds,
    modelById,
    modelOptions,
    modelDropdownItems,
    currentModelLabel,
    reconcileCurrentModel,
    loadModels,
  };
}
