<script setup lang="ts">
import { Plus, Server, Trash2, Edit3, KeyRound, Lock } from "@lucide/vue";
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Tag,
  message,
} from "antdv-next";
import { computed, onMounted, reactive, ref } from "vue";
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
onMounted(loadProviders);

// ============ 添加 / 编辑弹窗 ============

const modalOpen = ref(false);
const editingId = ref<string | null>(null);

interface ModelRow {
  id: string;
  name: string;
  contextLength: number | null;
}

const form = reactive({
  presetId: "opencode",
  name: "",
  baseUrl: "",
  api: "chat/completions" as ProviderApi,
  apiKey: "",
  models: [] as ModelRow[],
});

const presetOptions = [
  ...PROVIDER_PRESETS.map((preset) => ({ label: preset.name, value: preset.id })),
  { label: "自定义", value: "custom" },
];

const openCreate = () => {
  editingId.value = null;
  applyPreset("opencode");
  modalOpen.value = true;
};

const openEdit = (provider: ProviderView) => {
  editingId.value = provider.id;
  form.presetId = "custom";
  form.name = provider.name;
  form.baseUrl = provider.baseUrl;
  form.api = provider.api;
  form.apiKey = "";
  form.models = provider.models.map((model) => ({
    id: model.id,
    name: model.name ?? "",
    contextLength: model.contextLength ?? null,
  }));
  modalOpen.value = true;
};

const applyPreset = (presetId: string) => {
  const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
  if (!preset) {
    form.presetId = "custom";
    return;
  }
  form.presetId = preset.id;
  form.name = preset.name;
  form.baseUrl = preset.baseUrl;
  form.api = preset.api;
  form.models = preset.models.map((model) => ({
    id: model.id,
    name: model.name ?? "",
    contextLength: model.contextLength ?? null,
  }));
  // 保留已输入的 key，切预设时不清空
  if (!form.apiKey) form.apiKey = preset.apiKeyEnv ? `$${preset.apiKeyEnv}` : "";
};

const addModelRow = () => {
  form.models.push({ id: "", name: "", contextLength: null });
};

const removeModelRow = (index: number) => {
  form.models.splice(index, 1);
};

const validModels = computed<ProviderModelInfo[]>(() =>
  form.models
    .filter((row) => row.id.trim().length > 0)
    .map((row) => ({
      id: row.id.trim(),
      ...(row.name.trim() ? { name: row.name.trim() } : {}),
      ...(row.contextLength && row.contextLength > 0 ? { contextLength: row.contextLength } : {}),
    })),
);

const canSave = computed(
  () =>
    form.name.trim().length > 0 &&
    form.baseUrl.trim().length > 0 &&
    (editingId.value !== null || form.apiKey.trim().length > 0) &&
    validModels.value.length > 0,
);

const handleSave = async () => {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const input: ProviderInput = {
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      api: form.api,
      models: validModels.value,
    };
    if (editingId.value) {
      await providerService.update(editingId.value, input);
      message.success("服务商已更新");
    } else {
      await providerService.create(input);
      message.success("服务商已添加");
    }
    modalOpen.value = false;
    await loadProviders();
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

const apiLabel = (api: ProviderApi) => (api === "responses" ? "Responses" : "Chat Completions");
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between">
      <div>
        <div class="text-[13px] font-semibold text-brand-foreground">服务商</div>
        <p class="mt-0.5 mb-0 text-[11px] leading-[16px] text-brand-muted">
          配置后由服务端转发请求，密钥加密存储，仅展示掩码。
        </p>
      </div>
      <Button type="primary" size="small" @click="openCreate">
        <Plus class="!h-[13px] !w-[13px]" />添加
      </Button>
    </div>

    <Spin :spinning="loading">
      <div class="flex flex-col gap-2">
        <div
          v-for="provider in providers"
          :key="provider.id"
          class="flex items-center gap-2 rounded-[8px] border border-solid border-brand-border bg-brand-surface-subtle/50 px-3 py-2.5"
        >
          <span
            class="grid h-7 w-7 flex-none place-items-center rounded-[6px] bg-brand-surface-subtle text-brand-accent"
          >
            <Server class="!h-[14px] !w-[14px]" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="truncate text-[12.5px] font-medium text-brand-foreground">
                {{ provider.name }}
              </span>
              <Tag class="!mr-0 !text-[10px]">{{ apiLabel(provider.api) }}</Tag>
            </div>
            <div class="mt-0.5 flex items-center gap-2 text-[10.5px] text-brand-muted">
              <span class="truncate">{{ provider.baseUrl }}</span>
              <span class="flex-none">{{ provider.models.length }} 个模型</span>
              <span class="flex flex-none items-center gap-0.5">
                <KeyRound class="!h-[10px] !w-[10px]" />
                {{ provider.hasKey ? provider.apiKeyMasked : "未配置" }}
              </span>
            </div>
          </div>
          <div class="flex flex-none items-center gap-1">
            <Button size="small" type="text" @click="openEdit(provider)">
              <Edit3 class="!h-[13px] !w-[13px]" />
            </Button>
            <Popconfirm
              title="删除服务商？"
              :description="`将移除「${provider.name}」及其模型`"
              ok-text="删除"
              cancel-text="取消"
              @confirm="handleDelete(provider.id, provider.name)"
            >
              <Button size="small" type="text" danger>
                <Trash2 class="!h-[13px] !w-[13px]" />
              </Button>
            </Popconfirm>
          </div>
        </div>

        <Empty
          v-if="!loading && providers.length === 0"
          :image="Empty.PRESENTED_IMAGE_SIMPLE"
          description="还没有配置服务商"
        />
      </div>
    </Spin>

    <Modal
      :open="modalOpen"
      :confirm-loading="saving"
      :title="editingId ? '编辑服务商' : '添加服务商'"
      :ok-text="editingId ? '保存' : '添加'"
      :ok-button-props="{ disabled: !canSave }"
      :width="560"
      centered
      wrap-class-name="provider-modal-wrap"
      @update:open="modalOpen = $event"
      @ok="handleSave"
    >
      <div v-if="!editingId" class="mb-3">
        <div class="mb-1 text-[11px] text-brand-muted">预设（可继续修改）</div>
        <Select
          :value="form.presetId"
          :options="presetOptions"
          class="w-full"
          @change="applyPreset($event as string)"
        />
      </div>

      <div class="flex flex-col gap-3">
        <div>
          <div class="mb-1 text-[11px] text-brand-muted">名称</div>
          <Input v-model:value="form.name" placeholder="如 DeepSeek" />
        </div>
        <div>
          <div class="mb-1 text-[11px] text-brand-muted">Base URL</div>
          <Input v-model:value="form.baseUrl" placeholder="https://api.deepseek.com" />
        </div>
        <div>
          <div class="mb-1 text-[11px] text-brand-muted">API 协议</div>
          <Select
            v-model:value="form.api"
            :options="[
              { label: 'Chat Completions', value: 'chat/completions' },
              { label: 'Responses', value: 'responses' },
            ]"
            class="w-full"
          />
        </div>
        <div>
          <div class="mb-1 flex items-center gap-1 text-[11px] text-brand-muted">
            <Lock class="!h-[10px] !w-[10px]" />API Key
            <span v-if="editingId" class="text-brand-ghost">（留空保留原密钥）</span>
          </div>
          <Input.Password
            v-model:value="form.apiKey"
            placeholder="sk-... 或 $ENV_VAR 引用服务端环境变量"
            autocomplete="new-password"
          />
        </div>

        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="text-[11px] text-brand-muted">模型（至少 1 个）</span>
            <Button size="small" type="link" class="!px-0" @click="addModelRow">+ 添加模型</Button>
          </div>
          <div class="flex max-h-[190px] flex-col gap-1.5 overflow-y-auto pr-1">
            <div
              v-for="(model, index) in form.models"
              :key="index"
              class="flex items-center gap-1.5"
            >
              <Input
                v-model:value="model.id"
                class="!w-[42%] flex-none"
                placeholder="模型 ID"
                size="small"
              />
              <Input
                v-model:value="model.name"
                class="flex-1"
                placeholder="显示名称（可选）"
                size="small"
              />
              <InputNumber
                v-model:value="model.contextLength"
                class="!w-[30%] flex-none"
                placeholder="上下文"
                size="small"
                :min="0"
              />
              <Button
                size="small"
                type="text"
                danger
                class="flex-none"
                @click="removeModelRow(index)"
              >
                <Trash2 class="!h-[12px] !w-[12px]" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
:global(.provider-modal-wrap .ant-modal-content) {
  border: 1px solid var(--brand-border);
  border-radius: 8px;
}
</style>
