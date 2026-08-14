<script setup lang="ts">
import { KeyRound, Plus, Save, Server, Sparkles, Trash2 } from "@lucide/vue";
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Spin,
  Tag,
  message,
} from "antdv-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { PROVIDER_PRESETS } from "../../features/provider-presets/providerPresets";
import {
  providerService,
  type ProviderApi,
  type ProviderInput,
  type ProviderModelInfo,
  type ProviderView,
} from "../../services/providers";

interface Emits {
  (e: "changed"): void;
}

const emit = defineEmits<Emits>();

const loading = ref(false);
const saving = ref(false);
const providers = ref<ProviderView[]>([]);
const selectedId = ref("");

// ============ 选中 Provider 的编辑草稿（面板模式，参考 pim） ============

interface ModelRow {
  id: string;
  name: string;
  contextLength: number | null;
}

const draft = reactive({
  name: "",
  baseUrl: "",
  api: "chat/completions" as ProviderApi,
  apiKey: "",
  models: [] as ModelRow[],
});

const apiKeyTouched = ref(false);

const providerOptions = computed(() =>
  providers.value.map((provider) => ({ label: provider.name, value: provider.id })),
);
const selectedProvider = computed(() =>
  providers.value.find((provider) => provider.id === selectedId.value),
);

const loadDraft = (provider: ProviderView) => {
  draft.name = provider.name;
  draft.baseUrl = provider.baseUrl;
  draft.api = provider.api;
  draft.apiKey = "";
  draft.models = provider.models.map((model) => ({
    id: model.id,
    name: model.name ?? "",
    contextLength: model.contextLength ?? null,
  }));
  apiKeyTouched.value = false;
};

const loadProviders = async () => {
  loading.value = true;
  try {
    providers.value = await providerService.list();
  } catch (err) {
    message.error((err as Error).message || "加载服务商失败");
  } finally {
    loading.value = false;
  }
};

watch(providers, (list) => {
  if (!list.some((provider) => provider.id === selectedId.value)) {
    selectedId.value = list[0]?.id ?? "";
  }
});

watch(selectedId, (id) => {
  const provider = providers.value.find((item) => item.id === id);
  if (provider) loadDraft(provider);
});

onMounted(loadProviders);

// ============ 校验 / 保存 ============

const validModels = computed<ProviderModelInfo[]>(() =>
  draft.models
    .filter((row) => row.id.trim().length > 0)
    .map((row) => ({
      id: row.id.trim(),
      ...(row.name.trim() ? { name: row.name.trim() } : {}),
      ...(row.contextLength && row.contextLength > 0 ? { contextLength: row.contextLength } : {}),
    })),
);

const dirty = computed(() => {
  const provider = selectedProvider.value;
  if (!provider) return false;
  const originalModels = provider.models.map((model) => ({
    id: model.id,
    name: model.name ?? "",
    contextLength: model.contextLength ?? null,
  }));
  return (
    draft.name !== provider.name ||
    draft.baseUrl !== provider.baseUrl ||
    draft.api !== provider.api ||
    draft.apiKey.trim() !== "" ||
    JSON.stringify(draft.models) !== JSON.stringify(originalModels)
  );
});

const canSave = computed(
  () =>
    draft.name.trim().length > 0 && draft.baseUrl.trim().length > 0 && validModels.value.length > 0,
);

const handleSave = async () => {
  const provider = selectedProvider.value;
  if (!provider || !canSave.value) return;
  saving.value = true;
  try {
    const input: ProviderInput = {
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      api: draft.api,
      models: validModels.value,
    };
    await providerService.update(provider.id, input);
    message.success("服务商已保存");
    await loadProviders();
    const updated = providers.value.find((item) => item.id === provider.id);
    if (updated) loadDraft(updated);
    emit("changed");
  } catch (err) {
    message.error((err as Error).message || "保存失败");
  } finally {
    saving.value = false;
  }
};

const handleDelete = async (id: string, name: string) => {
  try {
    await providerService.remove(id);
    message.success(`已删除「${name}」`);
    await loadProviders();
    emit("changed");
  } catch (err) {
    message.error((err as Error).message || "删除失败");
  }
};

const addModelRow = () => {
  draft.models.push({ id: "", name: "", contextLength: null });
};

const removeModelRow = (index: number) => {
  draft.models.splice(index, 1);
};

// ============ 添加服务商（预设 / 手动） ============

const addOpen = ref(false);
const addMode = ref<"preset" | "manual">("preset");
const draftId = ref("");
const draftPresetId = ref("");

const openCreate = () => {
  addMode.value = PROVIDER_PRESETS.length ? "preset" : "manual";
  draftPresetId.value = PROVIDER_PRESETS[0]?.id ?? "";
  draftId.value = "";
  addOpen.value = true;
};

const handleAdd = async () => {
  const id = draftId.value.trim();
  let input: ProviderInput;
  if (addMode.value === "preset") {
    const preset = PROVIDER_PRESETS.find((item) => item.id === draftPresetId.value);
    if (!preset) return;
    // Provider ID 留空时使用预设 id；密钥留空，导入后在面板中直接填写
    // （密钥仅存浏览器本地，随请求转发）。
    input = {
      name: id || preset.name,
      baseUrl: preset.baseUrl,
      apiKey: "",
      api: preset.api,
      models: preset.models,
    };
  } else {
    if (!id) {
      message.warning("请填写 Provider ID");
      return;
    }
    input = {
      name: id,
      baseUrl: "",
      apiKey: "",
      api: "chat/completions",
      models: [],
    };
  }
  saving.value = true;
  try {
    const provider = await providerService.create(input);
    message.success(
      addMode.value === "preset"
        ? `已导入「${provider.name}」，请在面板中核对连接信息与模型`
        : `已创建「${provider.name}」，请在面板中补全连接信息与模型`,
    );
    addOpen.value = false;
    await loadProviders();
    selectedId.value = provider.id;
    emit("changed");
  } catch (err) {
    message.error((err as Error).message || "添加失败");
  } finally {
    saving.value = false;
  }
};

// ============ 从预设导入模型 ============

const importOpen = ref(false);
const importPresetId = ref("");
const importSelection = ref<string[]>([]);

const presetsWithModels = computed(() =>
  PROVIDER_PRESETS.filter((preset) => preset.models.length > 0),
);
const importPreset = computed(() =>
  presetsWithModels.value.find((preset) => preset.id === importPresetId.value),
);
const existingModelIds = computed(
  () => new Set(draft.models.map((model) => model.id.trim()).filter(Boolean)),
);

watch(importOpen, (open) => {
  if (!open) return;
  const matching = presetsWithModels.value.find((preset) =>
    preset.models.some((model) => existingModelIds.value.has(model.id)),
  );
  importPresetId.value = (matching ?? presetsWithModels.value[0])?.id ?? "";
  importSelection.value = [];
});

const handleImportModels = () => {
  const preset = importPreset.value;
  if (!preset || importSelection.value.length === 0) {
    message.warning("请先选择要导入的模型");
    return;
  }
  const chosen = preset.models.filter((model) => importSelection.value.includes(model.id));
  for (const model of chosen) {
    draft.models.push({
      id: model.id,
      name: model.name ?? "",
      contextLength: model.contextLength ?? null,
    });
  }
  importOpen.value = false;
  message.success(`已添加 ${chosen.length} 个模型`);
};

const apiLabel = (api: ProviderApi) => (api === "responses" ? "Responses" : "Chat Completions");
</script>

<template>
  <div>
    <div class="provider-header">
      <Segmented
        v-if="providerOptions.length"
        :value="selectedId"
        :options="providerOptions"
        class="provider-switch"
        @change="selectedId = $event as string"
      />
      <Button type="primary" size="small" @click="openCreate">
        <Plus class="!h-[13px] !w-[13px]" />添加服务商
      </Button>
    </div>

    <Spin :spinning="loading">
      <template v-if="selectedProvider">
        <!-- 连接信息 -->
        <div class="panel-card">
          <div class="panel-card-head">
            <span class="provider-name-icon"><Server class="!h-[14px] !w-[14px]" /></span>
            <span class="provider-title">{{ selectedProvider.name }}</span>
            <Tag class="!mr-0 !text-[10px]">{{ apiLabel(draft.api) }}</Tag>
            <span class="ml-auto flex items-center gap-0.5 text-[10.5px] text-brand-muted">
              <KeyRound class="!h-[10px] !w-[10px]" />
              {{ selectedProvider.hasKey ? selectedProvider.apiKeyMasked : "未配置密钥" }}
            </span>
            <Popconfirm
              title="删除服务商？"
              :description="`将移除「${selectedProvider.name}」及其全部模型`"
              ok-text="删除"
              cancel-text="取消"
              @confirm="handleDelete(selectedProvider.id, selectedProvider.name)"
            >
              <Button size="small" type="text" danger class="ml-2">
                <Trash2 class="!h-[13px] !w-[13px]" />
              </Button>
            </Popconfirm>
          </div>

          <div class="panel-form-grid">
            <label class="panel-field">
              <span>名称</span>
              <Input v-model:value="draft.name" placeholder="如 DeepSeek" />
            </label>
            <label class="panel-field">
              <span>Base URL</span>
              <Input v-model:value="draft.baseUrl" placeholder="https://api.deepseek.com" />
            </label>
            <label class="panel-field">
              <span>API 协议</span>
              <Select
                v-model:value="draft.api"
                :options="[
                  { label: 'Chat Completions', value: 'chat/completions' },
                  { label: 'Responses', value: 'responses' },
                ]"
              />
            </label>
            <label class="panel-field">
              <span>API Key</span>
              <Input.Password
                v-model:value="draft.apiKey"
                placeholder="$ENV_VAR 或 sk-...，留空保留原密钥"
                autocomplete="new-password"
                @input="apiKeyTouched = true"
              />
            </label>
          </div>
          <p class="panel-hint">
            密钥仅保存在浏览器本地（IndexedDB），发送请求时随请求体转发给服务端，服务端不落盘。
          </p>
        </div>

        <!-- 模型目录 -->
        <div class="panel-card">
          <div class="panel-card-head">
            <span class="panel-card-title">模型目录</span>
            <span class="panel-card-subtitle">{{ validModels.length }} 个模型</span>
            <div class="ml-auto flex items-center gap-1">
              <Button size="small" type="text" @click="importOpen = true">
                <Sparkles class="!h-[13px] !w-[13px]" />从预设导入
              </Button>
              <Button size="small" type="primary" @click="addModelRow">
                <Plus class="!h-[13px] !w-[13px]" />添加模型
              </Button>
            </div>
          </div>

          <div v-if="draft.models.length" class="model-table">
            <div class="model-table-row model-table-head">
              <span class="model-col-id">模型 ID</span>
              <span class="model-col-name">显示名称</span>
              <span class="model-col-ctx">上下文窗口</span>
              <span class="model-col-action"></span>
            </div>
            <div v-for="(model, index) in draft.models" :key="index" class="model-table-row">
              <span class="model-col-id">
                <Input v-model:value="model.id" placeholder="model-id" size="small" />
              </span>
              <span class="model-col-name">
                <Input v-model:value="model.name" placeholder="可选" size="small" />
              </span>
              <span class="model-col-ctx">
                <InputNumber
                  v-model:value="model.contextLength"
                  class="!w-full"
                  placeholder="128000"
                  size="small"
                  :min="0"
                />
              </span>
              <span class="model-col-action">
                <Button size="small" type="text" danger @click="removeModelRow(index)">
                  <Trash2 class="!h-[12px] !w-[12px]" />
                </Button>
              </span>
            </div>
          </div>
          <Empty
            v-else
            :image="Empty.PRESENTED_IMAGE_SIMPLE"
            description="还没有模型，点击「添加模型」或「从预设导入」"
          />
        </div>

        <!-- 保存栏 -->
        <div class="panel-save-bar">
          <span v-if="dirty" class="unsaved-tag">有未保存的更改</span>
          <Button
            type="primary"
            :loading="saving"
            :disabled="!dirty || !canSave"
            @click="handleSave"
          >
            <Save class="!h-[13px] !w-[13px]" />保存更改
          </Button>
        </div>
      </template>

      <Empty v-else-if="!loading && providers.length === 0" description="还没有服务商" class="mt-6">
        <Button type="primary" @click="openCreate">添加第一个服务商</Button>
      </Empty>
    </Spin>

    <!-- 添加服务商弹窗 -->
    <Modal
      :open="addOpen"
      :confirm-loading="saving"
      title="添加服务商"
      :ok-text="addMode === 'preset' ? '导入' : '创建'"
      :width="520"
      centered
      wrap-class-name="provider-modal-wrap"
      @update:open="addOpen = $event"
      @ok="handleAdd"
    >
      <Segmented
        :value="addMode"
        :options="[
          { label: '从预设导入', value: 'preset' },
          { label: '自定义', value: 'manual' },
        ]"
        class="mb-4"
        @change="addMode = $event as 'preset' | 'manual'"
      />

      <template v-if="addMode === 'preset'">
        <div class="mb-1 text-[11px] text-brand-muted">选择预设（导入后可在面板中修改）</div>
        <div class="preset-list">
          <label
            v-for="preset in PROVIDER_PRESETS"
            :key="preset.id"
            class="preset-item"
            :class="{ 'is-selected': draftPresetId === preset.id }"
          >
            <input
              v-model="draftPresetId"
              type="radio"
              :value="preset.id"
              class="accent-[var(--brand-primary)]"
            />
            <span class="preset-item-body">
              <span class="preset-item-head">
                <strong>{{ preset.name }}</strong>
                <Tag class="!mr-0 !text-[10px]">{{ preset.models.length }} 个模型</Tag>
              </span>
              <span class="preset-item-desc">{{ preset.description }}</span>
              <code class="preset-item-url">{{ preset.baseUrl }}</code>
            </span>
          </label>
        </div>
        <div class="mt-3">
          <div class="mb-1 text-[11px] text-brand-muted">Provider ID（留空使用预设）</div>
          <Input v-model:value="draftId" :placeholder="draftPresetId" />
        </div>
        <p class="mt-2 mb-0 text-[10.5px] leading-[16px] text-brand-muted">
          预设只是起点：导入后请在面板中核对连接信息、密钥引用与模型清单。
        </p>
      </template>

      <template v-else>
        <div>
          <div class="mb-1 text-[11px] text-brand-muted">Provider ID</div>
          <Input
            v-model:value="draftId"
            placeholder="如 deepseek 或 company-proxy"
            autofocus
            @press-enter="handleAdd"
          />
          <p class="mt-2 mb-0 text-[10.5px] leading-[16px] text-brand-muted">
            先创建空 Provider，随后在面板中依次设置 API Key 与模型。
          </p>
        </div>
      </template>
    </Modal>

    <!-- 从预设导入模型弹窗 -->
    <Modal
      :open="importOpen"
      title="从预设导入模型"
      ok-text="添加"
      cancel-text="取消"
      :width="520"
      centered
      wrap-class-name="provider-modal-wrap"
      @update:open="importOpen = $event"
      @ok="handleImportModels"
    >
      <div class="mb-3">
        <div class="mb-1 text-[11px] text-brand-muted">预设来源</div>
        <Select
          :value="importPresetId"
          :options="presetsWithModels.map((preset) => ({ label: preset.name, value: preset.id }))"
          class="w-full"
          @change="importPresetId = $event as string"
        />
      </div>
      <div class="mb-1 text-[11px] text-brand-muted">选择模型</div>
      <div
        class="max-h-[260px] overflow-y-auto rounded-[8px] border border-solid border-brand-border p-2"
      >
        <label
          v-for="model in importPreset?.models ?? []"
          :key="model.id"
          class="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[12px] hover:bg-brand-surface-subtle"
        >
          <input
            v-model="importSelection"
            type="checkbox"
            :value="model.id"
            :disabled="existingModelIds.has(model.id)"
            class="accent-[var(--brand-primary)]"
          />
          <span class="min-w-0 flex-1 truncate">{{ model.name ?? model.id }}</span>
          <code class="text-[10px] text-brand-muted">{{ model.id }}</code>
          <span v-if="existingModelIds.has(model.id)" class="text-[10px] text-brand-muted">
            已存在
          </span>
        </label>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
/* antdv-next 的 Modal 容器类是 .ant-modal-container（不是 .ant-modal-content） */
:global(.provider-modal-wrap .ant-modal-container) {
  border: 1px solid var(--brand-border);
  border-radius: 8px;
}
.provider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.provider-switch {
  min-width: 0;
}

.panel-card {
  border: 1px solid var(--brand-border);
  border-radius: 10px;
  background: var(--brand-surface);
  padding: 14px 16px;
}
.panel-card + .panel-card {
  margin-top: 12px;
}
.panel-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.provider-name-icon {
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 6px;
  background: var(--brand-surface-subtle);
  color: var(--brand-accent);
}
.provider-title {
  font-size: 12.5px;
  font-weight: 680;
  color: var(--brand-foreground);
}
.panel-card-title {
  font-size: 12.5px;
  font-weight: 680;
  color: var(--brand-foreground);
}
.panel-card-subtitle {
  font-size: 10px;
  color: var(--brand-muted);
}
.panel-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.panel-field {
  display: grid;
  gap: 5px;
}
.panel-field > span {
  color: var(--brand-muted-strong);
  font-size: 10.5px;
  font-weight: 650;
}
.panel-hint {
  margin: 10px 0 0;
  color: var(--brand-muted);
  font-size: 10px;
  line-height: 1.5;
}
.panel-hint code {
  border-radius: 4px;
  background: var(--brand-surface-subtle);
  padding: 1px 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9.5px;
}

.model-table {
  border: 1px solid var(--brand-border);
  border-radius: 8px;
  overflow: hidden;
}
.model-table-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
}
.model-table-row + .model-table-row {
  border-top: 1px solid var(--brand-border);
}
.model-table-head {
  background: var(--brand-surface-subtle);
  color: var(--brand-muted);
  font-size: 10px;
  font-weight: 650;
}
.model-col-id {
  width: 34%;
  flex: 0 0 34%;
  min-width: 0;
}
.model-col-name {
  flex: 1;
  min-width: 0;
}
.model-col-ctx {
  width: 22%;
  flex: 0 0 22%;
  min-width: 0;
}
.model-col-action {
  width: 30px;
  flex: 0 0 30px;
  text-align: right;
}

.panel-save-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
.unsaved-tag {
  border-radius: 999px;
  background: var(--brand-surface-subtle);
  padding: 3px 9px;
  color: var(--brand-muted-strong);
  font-size: 9.5px;
  font-weight: 650;
}

/* 添加服务商弹窗：预设卡片列表（对齐 pim） */
.preset-list {
  display: grid;
  max-height: 280px;
  gap: 8px;
  overflow-y: auto;
}
.preset-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
  background: var(--brand-surface);
  padding: 10px 12px;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease;
}
.preset-item:hover {
  border-color: var(--brand-border-strong);
  background: var(--brand-surface-subtle);
}
.preset-item.is-selected {
  border-color: var(--brand-primary);
  background: color-mix(in srgb, var(--brand-primary) 8%, var(--brand-surface));
}
.preset-item-body {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.preset-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preset-item-head strong {
  color: var(--brand-foreground);
  font-size: 12px;
  font-weight: 680;
}
.preset-item-desc {
  color: var(--brand-muted);
  font-size: 10.5px;
  line-height: 1.5;
}
.preset-item-url {
  color: var(--brand-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9.5px;
}

@media (max-width: 560px) {
  .panel-form-grid {
    grid-template-columns: 1fr;
  }
  .provider-header {
    align-items: stretch;
    flex-direction: column;
  }
  .provider-switch {
    max-width: 100%;
    overflow-x: auto;
  }
}
</style>
