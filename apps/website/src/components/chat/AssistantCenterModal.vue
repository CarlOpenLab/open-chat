<script setup lang="ts">
import {
  ArrowLeft,
  Bookmark,
  Bot,
  Check,
  Download,
  FileText,
  GitFork,
  Globe2,
  LayoutPanelTop,
  Plus,
  Search,
  Save,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  X,
} from "@lucide/vue";
import { Button, message } from "antdv-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ASSISTANT_CATEGORIES,
  OFFICIAL_ASSISTANTS,
  createAssistantConversationSnapshot,
  createCustomAssistantDefinition,
} from "../../features/assistant-market/catalog";
import AssistantCard from "../../features/assistant-market/components/AssistantCard.vue";
import AssistantIcon from "../../features/assistant-market/components/AssistantIcon.vue";
import {
  loadCustomAssistants,
  saveCustomAssistants,
} from "../../features/assistant-market/assistantStorage";
import type {
  AssistantCapability,
  AssistantCategory,
  AssistantDefinition,
} from "../../features/assistant-market/types";
import { useAssistantInstallations } from "../../features/assistant-market/useAssistantInstallations";
import AssistantOpeningMessageEditor from "./AssistantOpeningMessageEditor.vue";

type CenterView = "market" | "installed" | "detail" | "create";

interface Props {
  open: boolean;
  dark: boolean;
  initialView?: "market" | "installed";
}

interface Emits {
  (e: "close"): void;
  (
    e: "use",
    assistant: ReturnType<typeof createAssistantConversationSnapshot>,
    starterPrompt?: string,
  ): void;
}

const props = withDefaults(defineProps<Props>(), { initialView: "market" });
const emit = defineEmits<Emits>();
const {
  hydrating: installationsHydrating,
  isInstalled,
  install,
  uninstall,
} = useAssistantInstallations();

const view = ref<CenterView>("market");
const searchQuery = ref("");
const selectedAssistant = ref<AssistantDefinition | null>(null);
const customAssistants = ref<AssistantDefinition[]>([]);
const customHydrating = ref(true);
const panel = ref<HTMLElement>();
const systemPromptDraft = ref("");
const initialAssistantMessageDraft = ref("");
let returnFocus: HTMLElement | null = null;

const form = ref({
  name: "",
  tagline: "",
  category: "效率" as AssistantCategory,
  systemPrompt: "",
  initialAssistantMessage: "",
  starterPrompt: "",
  capabilities: [] as AssistantCapability[],
});

const allAssistants = computed(() => [...OFFICIAL_ASSISTANTS, ...customAssistants.value]);
const visibleAssistants = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  const source = view.value === "installed" ? allAssistants.value : OFFICIAL_ASSISTANTS;
  return source.filter((assistant) => {
    if (view.value === "installed" && assistant.source !== "custom" && !isInstalled(assistant.id)) {
      return false;
    }
    if (!query) return true;
    return [assistant.name, assistant.tagline, assistant.description, ...assistant.tags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });
});
const installedAssistantCount = computed(
  () =>
    allAssistants.value.filter(
      (assistant) => assistant.source === "custom" || isInstalled(assistant.id),
    ).length,
);
const selectedIsInstalled = computed(() =>
  selectedAssistant.value
    ? selectedAssistant.value.source === "custom" || isInstalled(selectedAssistant.value.id)
    : false,
);
const selectedIsCustom = computed(() => selectedAssistant.value?.source === "custom");
const selectedRenderedSystemPrompt = computed(() =>
  selectedAssistant.value
    ? createAssistantConversationSnapshot(selectedAssistant.value).renderedSystemPrompt
    : "",
);
const systemPromptDirty = computed(
  () => systemPromptDraft.value.trim() !== selectedRenderedSystemPrompt.value,
);
const selectedInitialAssistantMessage = computed(
  () => selectedAssistant.value?.initialAssistantMessage?.trim() ?? "",
);
const initialAssistantMessageDirty = computed(
  () => initialAssistantMessageDraft.value.trim() !== selectedInitialAssistantMessage.value,
);
const assistantConfigDirty = computed(
  () => systemPromptDirty.value || initialAssistantMessageDirty.value,
);
const isHydrating = computed(() => installationsHydrating.value || customHydrating.value);
const capabilityLabels: Record<AssistantCapability, string> = {
  a2ui: "交互界面",
  files: "文件工作区",
  "web-search": "联网搜索",
};
const capabilityOptions: Array<{ key: AssistantCapability; label: string; description: string }> = [
  { key: "files", label: "文件工作区", description: "读取、编辑和预览文件" },
  { key: "web-search", label: "联网搜索", description: "检索最新公开信息" },
  { key: "a2ui", label: "交互界面", description: "生成可操作的表单和控件" },
];
const capabilityIcon = (key: AssistantCapability) =>
  key === "files" ? FileText : key === "web-search" ? Globe2 : LayoutPanelTop;

const toggleCapability = (capability: AssistantCapability) => {
  form.value.capabilities = form.value.capabilities.includes(capability)
    ? form.value.capabilities.filter((item) => item !== capability)
    : [...form.value.capabilities, capability];
};

const formatInstallCount = (count: number) =>
  new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(count);

const resetForm = () => {
  form.value = {
    name: "",
    tagline: "",
    category: "效率",
    systemPrompt: "",
    initialAssistantMessage: "",
    starterPrompt: "",
    capabilities: [],
  };
};

const openView = (nextView: "market" | "installed") => {
  view.value = nextView;
  selectedAssistant.value = null;
  searchQuery.value = "";
};

const openDetail = (assistant: AssistantDefinition) => {
  selectedAssistant.value = assistant;
  systemPromptDraft.value = createAssistantConversationSnapshot(assistant).renderedSystemPrompt;
  initialAssistantMessageDraft.value = assistant.initialAssistantMessage ?? "";
  view.value = "detail";
};

const nextPatchVersion = (version: string) => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return version;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
};

const savePrivateSystemPrompt = async () => {
  const assistant = selectedAssistant.value;
  const systemPrompt = systemPromptDraft.value.trim();
  if (!assistant || assistant.source !== "custom" || !systemPrompt) {
    message.warning("system prompt 不能为空");
    return;
  }
  const updatedAssistant: AssistantDefinition = {
    ...assistant,
    systemPrompt,
    initialAssistantMessage: initialAssistantMessageDraft.value.trim() || undefined,
    versionId: `${assistant.id}-${Date.now()}`,
    version: nextPatchVersion(assistant.version),
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  customAssistants.value = customAssistants.value.map((item) =>
    item.id === assistant.id ? updatedAssistant : item,
  );
  await saveCustomAssistants(customAssistants.value);
  selectedAssistant.value = updatedAssistant;
  systemPromptDraft.value = systemPrompt;
  initialAssistantMessageDraft.value = updatedAssistant.initialAssistantMessage ?? "";
  message.success("助手配置已保存为新版本");
};

const forkOfficialAssistant = async () => {
  const assistant = selectedAssistant.value;
  const systemPrompt = systemPromptDraft.value.trim();
  if (!assistant || assistant.source === "custom" || !systemPrompt) {
    message.warning("system prompt 不能为空");
    return;
  }
  const forkNumber =
    customAssistants.value.filter((item) => item.forkedFromAssistantId === assistant.id).length + 1;
  const fork = createCustomAssistantDefinition({
    name: `${assistant.name} 副本${forkNumber > 1 ? ` ${forkNumber}` : ""}`,
    tagline: assistant.tagline,
    description: assistant.description,
    category: assistant.category,
    systemPrompt,
    initialAssistantMessage: initialAssistantMessageDraft.value,
    capabilities: assistant.capabilities,
    starterPrompts: assistant.starterPrompts,
    icon: assistant.icon,
    tags: [...assistant.tags, "私人副本"],
    forkedFromAssistantId: assistant.id,
  });
  customAssistants.value = [fork, ...customAssistants.value];
  await saveCustomAssistants(customAssistants.value);
  await install(fork.id);
  selectedAssistant.value = fork;
  systemPromptDraft.value = systemPrompt;
  message.success(`已创建「${fork.name}」`);
};

const resetSystemPromptDraft = () => {
  systemPromptDraft.value = selectedRenderedSystemPrompt.value;
  initialAssistantMessageDraft.value = selectedInitialAssistantMessage.value;
};

const useAssistant = async (assistant: AssistantDefinition, starterPrompt?: string) => {
  await install(assistant.id);
  emit("use", createAssistantConversationSnapshot(assistant), starterPrompt);
};

const handleInstall = async (assistant: AssistantDefinition) => {
  await install(assistant.id);
  message.success(`已安装「${assistant.name}」`);
};

const handleUninstall = async (assistant: AssistantDefinition) => {
  if (assistant.source === "custom") {
    customAssistants.value = customAssistants.value.filter((item) => item.id !== assistant.id);
    await saveCustomAssistants(customAssistants.value);
    await uninstall(assistant.id);
    if (selectedAssistant.value?.id === assistant.id) selectedAssistant.value = null;
    message.success(`已删除「${assistant.name}」`);
    return;
  }
  await uninstall(assistant.id);
  message.success(`已从我的助手中移除「${assistant.name}」`);
};

const saveCustom = async () => {
  const name = form.value.name.trim();
  const systemPrompt = form.value.systemPrompt.trim();
  if (!name || !systemPrompt) {
    message.warning("请填写助手名称和 system prompt");
    return;
  }
  const starterPrompt = form.value.starterPrompt.trim();
  const assistant = createCustomAssistantDefinition({
    name,
    tagline: form.value.tagline,
    description: form.value.tagline,
    category: form.value.category,
    systemPrompt,
    initialAssistantMessage: form.value.initialAssistantMessage,
    capabilities: form.value.capabilities,
    starterPrompts: starterPrompt
      ? [
          {
            id: `${name}-starter`,
            label: "开始使用",
            description: "使用你设定的开场问题",
            prompt: starterPrompt,
          },
        ]
      : undefined,
  });
  customAssistants.value = [assistant, ...customAssistants.value];
  await saveCustomAssistants(customAssistants.value);
  await install(assistant.id);
  resetForm();
  view.value = "installed";
  selectedAssistant.value = assistant;
  message.success("私人助手已保存");
};

const close = () => emit("close");

const handleKeydown = (event: KeyboardEvent) => {
  if (props.open && event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (props.open && event.key === "Tab") {
    const focusable = [
      ...(panel.value?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
};

watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      view.value = props.initialView;
      selectedAssistant.value = null;
      searchQuery.value = "";
      await nextTick();
      panel.value?.querySelector<HTMLButtonElement>('[aria-label="关闭助手中心"]')?.focus();
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      await nextTick();
      returnFocus?.focus();
      returnFocus = null;
    }
  },
  { immediate: true },
);

void loadCustomAssistants().then((assistants) => {
  customAssistants.value = assistants;
  customHydrating.value = false;
});

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  document.body.style.overflow = "";
});
</script>

<template>
  <Transition name="assistant-modal-fade">
    <div
      v-if="open"
      class="assistant-center fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(9,9,11,0.55)] p-6 backdrop-blur-[5px] lt-md:items-end lt-md:p-0"
      role="presentation"
      @click.self="close"
    >
      <section
        ref="panel"
        class="assistant-center-panel flex h-[min(760px,calc(100dvh-48px))] w-[min(1000px,calc(100vw-48px))] flex-col overflow-hidden rounded-[14px] border border-solid border-brand-border bg-brand-background shadow-[0_26px_80px_rgba(9,9,11,0.28)] lt-md:h-[min(92dvh,760px)] lt-md:w-full lt-md:rounded-b-0 lt-md:rounded-t-[16px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-center-title"
      >
        <header
          class="flex min-h-[66px] items-center justify-between gap-4 border-b border-b-solid border-brand-border px-6 lt-md:min-h-[60px] lt-md:px-4"
        >
          <div class="flex min-w-0 items-center gap-3">
            <span
              class="grid h-9 w-9 flex-[0_0_36px] place-items-center rounded-[8px] bg-brand-primary text-brand-primary-foreground"
            >
              <Sparkles class="!h-[17px] !w-[17px]" />
            </span>
            <div class="min-w-0">
              <h2 id="assistant-center-title" class="m-0 truncate text-[15px] font-720">
                助手中心
              </h2>
              <p class="m-0 mt-1 truncate text-[10px] text-brand-muted">
                在当前对话中选择或创建一个专业助手
              </p>
            </div>
          </div>
          <Button
            type="text"
            shape="circle"
            class="grid h-9 w-9 flex-[0_0_36px] place-items-center rounded-[7px] border-0 bg-transparent text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground lt-md:h-11 lt-md:w-11 lt-md:flex-[0_0_44px]"
            aria-label="关闭助手中心"
            @click="close"
          >
            <X class="!h-[18px] !w-[18px]" />
          </Button>
        </header>

        <div class="flex min-h-0 flex-1">
          <nav
            class="flex w-[212px] flex-[0_0_212px] flex-col border-r border-r-solid border-brand-border bg-brand-surface-subtle/40 p-3 lt-md:hidden"
            aria-label="助手中心导航"
          >
            <p
              class="mx-2 mt-1 mb-2 text-[9px] font-700 uppercase tracking-[0.1em] text-brand-muted"
            >
              助手库
            </p>
            <div class="grid gap-1">
              <Button
                type="text"
                block
                class="assistant-center-nav"
                :class="view === 'market' || view === 'detail' ? 'is-active' : ''"
                @click="openView('market')"
              >
                <span class="assistant-center-nav-icon"><Store /></span>
                <span class="assistant-center-nav-copy"
                  ><strong>助手市场</strong><small>浏览官方精选</small></span
                >
                <span class="assistant-center-nav-count">{{ OFFICIAL_ASSISTANTS.length }}</span>
              </Button>
              <Button
                type="text"
                block
                class="assistant-center-nav"
                :class="view === 'installed' ? 'is-active' : ''"
                @click="openView('installed')"
              >
                <span class="assistant-center-nav-icon"><Bookmark /></span>
                <span class="assistant-center-nav-copy"
                  ><strong>我的助手</strong><small>已安装与私人助手</small></span
                >
                <span class="assistant-center-nav-count">{{ installedAssistantCount }}</span>
              </Button>
            </div>
            <div class="mt-auto border-t border-t-solid border-brand-border pt-3">
              <Button
                type="primary"
                block
                class="assistant-center-create-button"
                @click="
                  view = 'create';
                  selectedAssistant = null;
                "
              >
                <Plus class="!h-[14px] !w-[14px]" />创建助手
              </Button>
            </div>
          </nav>

          <main class="min-w-0 flex-1 overflow-y-auto px-7 py-6 lt-md:px-4 lt-md:py-5">
            <div class="mb-5 hidden gap-2 lt-md:flex">
              <Button
                class="assistant-center-mobile-tab"
                :class="view !== 'installed' && view !== 'create' ? 'is-active' : ''"
                @click="openView('market')"
              >
                <span>市场</span>
              </Button>
              <Button
                class="assistant-center-mobile-tab"
                :class="view === 'installed' ? 'is-active' : ''"
                @click="openView('installed')"
              >
                我的助手
              </Button>
              <Button
                class="assistant-center-mobile-tab"
                :class="view === 'create' ? 'is-active' : ''"
                @click="
                  view = 'create';
                  selectedAssistant = null;
                "
              >
                <span>创建</span>
              </Button>
            </div>

            <template v-if="view === 'create'">
              <Button
                type="text"
                class="mb-4 inline-flex min-h-8 items-center gap-2 border-0 bg-transparent px-0 text-[11px] font-650 text-brand-muted hover:text-brand-foreground lt-md:min-h-11"
                @click="openView('market')"
              >
                <ArrowLeft class="!h-4 !w-4" />返回市场
              </Button>
              <div class="max-w-[700px]">
                <p class="m-0 text-[10px] font-700 uppercase tracking-[0.12em] text-brand-muted">
                  Personal assistant
                </p>
                <h3 class="mt-2 mb-0 text-[26px] font-750 tracking-[-0.03em]">创建你的私人助手</h3>
                <p class="mt-2 mb-6 text-[12px] leading-[1.7] text-brand-muted">
                  把稳定的工作方式写进 system prompt，助手会保存在当前设备，不会发布到公共市场。
                </p>
                <div class="grid gap-4">
                  <label class="assistant-form-field"
                    ><span>名称 <i>*</i></span
                    ><input
                      v-model="form.name"
                      type="text"
                      maxlength="40"
                      placeholder="例如：我的周报教练"
                  /></label>
                  <label class="assistant-form-field"
                    ><span>一句话简介</span
                    ><input
                      v-model="form.tagline"
                      type="text"
                      maxlength="90"
                      placeholder="它最擅长帮你完成什么？"
                  /></label>
                  <label class="assistant-form-field"
                    ><span>分类</span
                    ><select v-model="form.category">
                      <option
                        v-for="category in ASSISTANT_CATEGORIES.slice(1)"
                        :key="category"
                        :value="category"
                      >
                        {{ category }}
                      </option>
                    </select></label
                  >
                  <label class="assistant-form-field"
                    ><span>system prompt <i>*</i></span
                    ><textarea
                      v-model="form.systemPrompt"
                      rows="8"
                      placeholder="你是谁？你应该如何工作？请写下稳定的角色、目标和边界。"
                    />
                  </label>
                  <AssistantOpeningMessageEditor
                    v-model="form.initialAssistantMessage"
                    :dark="dark"
                  />
                  <label class="assistant-form-field"
                    ><span>快捷开始问题（可选）</span
                    ><textarea
                      v-model="form.starterPrompt"
                      rows="3"
                      placeholder="例如：帮我把这周的工作整理成一份周报。"
                    />
                  </label>
                  <section
                    class="assistant-form-field"
                    aria-labelledby="assistant-capabilities-title"
                  >
                    <span id="assistant-capabilities-title">启用能力</span>
                    <div class="assistant-capability-grid">
                      <Button
                        v-for="option in capabilityOptions"
                        :key="option.key"
                        block
                        class="assistant-capability"
                        :class="{ 'is-selected': form.capabilities.includes(option.key) }"
                        :aria-pressed="form.capabilities.includes(option.key)"
                        @click="toggleCapability(option.key)"
                      >
                        <span class="assistant-capability-icon"
                          ><component
                            :is="capabilityIcon(option.key)"
                            class="!h-[15px] !w-[15px]" /></span
                        ><span class="min-w-0 flex-1 text-left"
                          ><strong>{{ option.label }}</strong
                          ><small>{{ option.description }}</small></span
                        ><span class="assistant-capability-check"
                          ><Check v-if="form.capabilities.includes(option.key)" class="!h-3 !w-3"
                        /></span>
                      </Button>
                    </div>
                  </section>
                </div>
                <div class="mt-6 flex flex-wrap justify-end gap-2">
                  <Button
                    class="min-h-9 rounded-[7px] border border-solid border-brand-border bg-transparent px-4 text-[11px] font-620 hover:bg-brand-surface-subtle lt-md:min-h-11"
                    @click="openView('market')"
                  >
                    <span>取消</span></Button
                  ><Button
                    type="primary"
                    class="min-h-9 rounded-[7px] border border-solid border-brand-primary bg-brand-primary px-5 text-[11px] font-700 text-brand-primary-foreground hover:bg-brand-primary-hover lt-md:min-h-11"
                    @click="saveCustom"
                  >
                    保存助手
                  </Button>
                </div>
              </div>
            </template>

            <template v-else-if="view === 'detail' && selectedAssistant">
              <Button
                type="text"
                class="mb-5 inline-flex min-h-8 items-center gap-2 border-0 bg-transparent px-0 text-[11px] font-650 text-brand-muted hover:text-brand-foreground lt-md:min-h-11"
                @click="openView('market')"
              >
                <ArrowLeft class="!h-4 !w-4" />返回助手市场
              </Button>
              <div class="grid grid-cols-[minmax(0,1fr)_250px] gap-7 lt-lg:grid-cols-1">
                <div>
                  <div class="flex items-start gap-4">
                    <span
                      class="grid h-14 w-14 flex-[0_0_56px] place-items-center rounded-[11px] border border-solid border-brand-border bg-brand-surface-subtle"
                      ><AssistantIcon :name="selectedAssistant.icon" class="!h-6 !w-6"
                    /></span>
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <h3 class="m-0 text-[25px] font-750">{{ selectedAssistant.name }}</h3>
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-brand-surface-subtle px-2 py-1 text-[9px] font-650 text-brand-muted-strong"
                          ><ShieldCheck
                            v-if="selectedAssistant.source !== 'custom'"
                            class="!h-3 !w-3"
                          />{{
                            selectedAssistant.forkedFromAssistantId
                              ? "私人副本"
                              : selectedAssistant.source === "custom"
                                ? "私人"
                                : "官方"
                          }}</span
                        >
                      </div>
                      <p class="mt-2 mb-0 text-[12px] leading-[1.65] text-brand-muted">
                        {{ selectedAssistant.tagline }}
                      </p>
                      <div class="mt-3 flex flex-wrap gap-3 text-[10px] text-brand-muted">
                        <span>{{ selectedAssistant.author }}</span
                        ><span
                          v-if="selectedAssistant.source !== 'custom'"
                          class="inline-flex items-center gap-1"
                          ><Star class="!h-3 !w-3 fill-current" />{{
                            selectedAssistant.rating.toFixed(1)
                          }}</span
                        ><span
                          v-if="selectedAssistant.source !== 'custom'"
                          class="inline-flex items-center gap-1"
                          ><Download class="!h-3 !w-3" />{{
                            formatInstallCount(selectedAssistant.installCount)
                          }}
                          次安装</span
                        >
                      </div>
                    </div>
                  </div>
                  <div class="mt-7 border-t border-t-solid border-brand-border pt-6">
                    <h4 class="m-0 text-[15px] font-700">关于这个助手</h4>
                    <p class="mt-2 mb-0 text-[12px] leading-[1.8] text-brand-muted-strong">
                      {{ selectedAssistant.description }}
                    </p>
                  </div>
                </div>
                <aside
                  class="h-fit rounded-[10px] border border-solid border-brand-border bg-brand-surface p-4"
                >
                  <Button
                    type="primary"
                    block
                    class="min-h-9 w-full rounded-[7px] border border-solid border-brand-primary bg-brand-primary px-3 text-[11px] font-700 text-brand-primary-foreground hover:bg-brand-primary-hover lt-md:min-h-11"
                    @click="useAssistant(selectedAssistant)"
                  >
                    使用此助手</Button
                  ><Button
                    block
                    class="mt-2 min-h-9 w-full rounded-[7px] border border-solid border-brand-border bg-transparent px-3 text-[10px] font-620 hover:bg-brand-surface-subtle lt-md:min-h-11"
                    @click="
                      selectedIsInstalled
                        ? handleUninstall(selectedAssistant)
                        : handleInstall(selectedAssistant)
                    "
                  >
                    <span v-if="selectedIsInstalled" class="inline-flex items-center gap-1.5"
                      ><Check class="!h-3.5 !w-3.5" />{{
                        selectedAssistant.source === "custom" ? "删除私人助手" : "已安装到我的助手"
                      }}</span
                    ><span v-else>安装到我的助手</span>
                  </Button>
                  <dl class="mt-5 mb-0 grid gap-3 border-t border-t-solid border-brand-border pt-4">
                    <div class="flex items-center justify-between">
                      <dt class="text-[10px] text-brand-muted">版本</dt>
                      <dd class="m-0 text-[10px] font-650">v{{ selectedAssistant.version }}</dd>
                    </div>
                    <div class="flex items-center justify-between">
                      <dt class="text-[10px] text-brand-muted">能力</dt>
                      <dd class="m-0 max-w-[150px] text-right text-[10px] font-650">
                        {{
                          selectedAssistant.capabilities.length
                            ? selectedAssistant.capabilities
                                .map((item) => capabilityLabels[item])
                                .join(" · ")
                            : "无"
                        }}
                      </dd>
                    </div>
                  </dl>
                </aside>
                <section
                  class="assistant-prompt-panel col-span-2 lt-lg:col-span-1"
                  aria-labelledby="system-prompt-title"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 id="system-prompt-title" class="m-0 text-[15px] font-700">
                        System prompt
                      </h4>
                      <p class="mt-1 mb-0 text-[10px] text-brand-muted">
                        {{
                          selectedIsCustom
                            ? "修改后会保存为这个私人助手的新版本。"
                            : "编辑官方版本时，将创建一个独立的私人副本。"
                        }}
                      </p>
                    </div>
                    <span
                      v-if="assistantConfigDirty"
                      class="rounded-full bg-brand-surface-subtle px-2 py-1 text-[9px] font-650 text-brand-muted-strong"
                      >未保存</span
                    >
                  </div>
                  <textarea
                    v-model="systemPromptDraft"
                    class="assistant-prompt-editor mt-3"
                    rows="9"
                    spellcheck="false"
                    aria-label="编辑 system prompt"
                  />
                  <AssistantOpeningMessageEditor
                    v-model="initialAssistantMessageDraft"
                    :dark="dark"
                    class="mt-5"
                  />
                  <div class="mt-3 flex flex-wrap justify-end gap-2">
                    <Button
                      size="small"
                      class="assistant-prompt-action"
                      :disabled="!assistantConfigDirty"
                      @click="resetSystemPromptDraft"
                    >
                      重置
                    </Button>
                    <Button
                      v-if="selectedIsCustom"
                      type="primary"
                      size="small"
                      class="assistant-prompt-action"
                      :disabled="!assistantConfigDirty || !systemPromptDraft.trim()"
                      @click="savePrivateSystemPrompt"
                    >
                      <Save class="!h-[13px] !w-[13px]" />保存修改
                    </Button>
                    <Button
                      v-else
                      type="primary"
                      size="small"
                      class="assistant-prompt-action"
                      :disabled="!assistantConfigDirty || !systemPromptDraft.trim()"
                      @click="forkOfficialAssistant"
                    >
                      <GitFork class="!h-[13px] !w-[13px]" />Fork 为私人助手
                    </Button>
                  </div>
                </section>
              </div>
            </template>

            <template v-else>
              <div class="flex items-end justify-between gap-4 lt-md:items-start">
                <div>
                  <p class="m-0 text-[10px] font-700 uppercase tracking-[0.12em] text-brand-muted">
                    {{ view === "installed" ? "Personal library" : "Open Chat assistants" }}
                  </p>
                  <h3 class="mt-2 mb-0 text-[25px] font-750 tracking-[-0.03em]">
                    {{ view === "installed" ? "我的助手" : "选择一个专业助手" }}
                  </h3>
                  <p class="mt-2 mb-0 text-[12px] text-brand-muted">
                    {{
                      view === "installed"
                        ? "安装和创建的助手都保存在当前设备。"
                        : "选择完成后会回到当前 Chat，不离开工作区。"
                    }}
                  </p>
                </div>
                <Button
                  class="hidden min-h-11 items-center gap-1.5 rounded-[7px] border border-solid border-brand-border bg-brand-surface px-3 text-[11px] font-650 hover:bg-brand-surface-subtle lt-md:flex"
                  @click="
                    view = 'create';
                    selectedAssistant = null;
                  "
                >
                  <Plus class="!h-3.5 !w-3.5" />创建助手
                </Button>
              </div>
              <div class="mt-6">
                <label class="relative block w-full max-w-[520px]" for="assistant-center-search"
                  ><Search
                    class="pointer-events-none absolute left-3 top-1/2 !h-[14px] !w-[14px] -translate-y-1/2 text-brand-muted" /><input
                    id="assistant-center-search"
                    v-model="searchQuery"
                    type="search"
                    aria-label="搜索助手"
                    class="h-[38px] w-full rounded-[7px] border border-solid border-brand-border bg-brand-surface pl-9 pr-3 text-[12px] outline-0 placeholder:text-brand-muted focus:border-brand-border-strong focus:shadow-[0_0_0_2px_var(--brand-ring)] lt-md:h-11 lt-md:text-[16px]"
                    placeholder="搜索助手、能力或场景"
                /></label>
              </div>
              <div
                v-if="isHydrating"
                class="grid min-h-[220px] place-items-center text-[11px] text-brand-muted"
              >
                正在读取助手库…
              </div>
              <div
                v-else-if="visibleAssistants.length"
                class="mt-5 grid grid-cols-2 gap-3 lt-md:grid-cols-1"
              >
                <AssistantCard
                  v-for="assistant in visibleAssistants"
                  :key="assistant.id"
                  :assistant="assistant"
                  :installed="assistant.source === 'custom' || isInstalled(assistant.id)"
                  compact
                  :manage-mode="view === 'installed'"
                  @view="openDetail(assistant)"
                  @edit="openDetail"
                  @use="useAssistant"
                  @install="handleInstall"
                  @uninstall="handleUninstall"
                />
              </div>
              <div
                v-else
                class="mt-5 grid min-h-[220px] place-items-center rounded-[9px] border border-dashed border-brand-border text-center"
              >
                <div>
                  <Bot class="mx-auto !h-7 !w-7 text-brand-muted" /><strong
                    class="mt-3 block text-[12px]"
                    >{{ view === "installed" ? "还没有安装助手" : "没有匹配的助手" }}</strong
                  >
                  <p class="mt-1 mb-0 text-[10px] text-brand-muted">
                    {{
                      view === "installed"
                        ? "去市场挑选一个适合你的助手。"
                        : "换个关键词或分类试试。"
                    }}
                  </p>
                  <Button
                    v-if="view === 'installed'"
                    type="primary"
                    class="mt-4 min-h-9 rounded-[6px] border border-solid border-brand-primary bg-brand-primary px-4 text-[11px] font-650 text-brand-primary-foreground lt-md:min-h-11"
                    @click="openView('market')"
                  >
                    浏览助手市场
                  </Button>
                </div>
              </div>
            </template>
          </main>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.assistant-center-nav {
  display: flex;
  min-height: 44px;
  width: 100%;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  padding: 5px 8px;
  color: var(--brand-muted);
  text-align: left;
  cursor: pointer;
}
.assistant-center-nav-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 6px;
  background: var(--brand-surface);
  color: var(--brand-muted);
}
.assistant-center-nav-icon svg {
  width: 14px;
  height: 14px;
}
.assistant-center-nav-copy {
  display: block;
  min-width: 0;
  flex: 1;
  line-height: 1.2;
}
.assistant-center-nav-copy strong,
.assistant-center-nav-copy small {
  display: block;
}
.assistant-center-nav-copy strong {
  color: var(--brand-foreground);
  font-size: 11px;
  font-weight: 680;
}
.assistant-center-nav-copy small {
  margin-top: 2px;
  color: var(--brand-muted);
  font-size: 9px;
  font-weight: 450;
}
.assistant-center-nav-count {
  min-width: 20px;
  border-radius: 10px;
  background: var(--brand-surface-subtle);
  padding: 2px 6px;
  color: var(--brand-muted);
  font-size: 9px;
  font-weight: 650;
  line-height: 1.4;
  text-align: center;
}
.assistant-center-nav:hover {
  border-color: var(--brand-border);
  background: var(--brand-surface);
}
.assistant-center-nav.is-active {
  border-color: var(--brand-border);
  background: var(--brand-surface);
  box-shadow:
    inset 2px 0 0 var(--brand-primary),
    var(--brand-shadow-xs);
  color: var(--brand-foreground);
}
.assistant-center-nav.is-active .assistant-center-nav-icon {
  border-color: var(--brand-primary);
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
}
.assistant-center-nav.is-active .assistant-center-nav-count {
  background: color-mix(in srgb, var(--brand-primary) 12%, var(--brand-surface));
  color: var(--brand-foreground);
}
.assistant-center-create-button {
  min-height: 38px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 680;
}
.assistant-prompt-panel {
  border-top: 1px solid var(--brand-border);
  padding-top: 24px;
}
.assistant-prompt-editor {
  width: 100%;
  min-height: 180px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
  background: var(--brand-surface);
  padding: 12px;
  color: var(--brand-foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.65;
  outline: none;
  resize: vertical;
}
.assistant-prompt-editor:focus {
  border-color: var(--brand-border-strong);
  box-shadow: 0 0 0 2px var(--brand-ring);
}
.assistant-center-mobile-tab {
  min-height: 36px;
  border: 1px solid var(--brand-border);
  border-radius: 6px;
  background: var(--brand-surface);
  padding: 0 12px;
  color: var(--brand-muted);
  font-size: 11px;
  font-weight: 650;
}
.assistant-center-mobile-tab.is-active {
  border-color: var(--brand-primary);
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
}
.assistant-form-field {
  display: grid;
  gap: 7px;
  color: var(--brand-muted-strong);
  font-size: 11px;
  font-weight: 650;
}
.assistant-form-field > span,
.assistant-form-field > legend {
  color: var(--brand-foreground);
}
.assistant-form-field i {
  color: var(--brand-danger, #d44);
  font-style: normal;
}
.assistant-form-field input,
.assistant-form-field textarea,
.assistant-form-field select {
  width: 100%;
  border: 1px solid var(--brand-border);
  border-radius: 7px;
  background: var(--brand-surface);
  padding: 10px 11px;
  color: var(--brand-foreground);
  font: inherit;
  font-weight: 450;
  outline: 0;
  resize: vertical;
}
.assistant-form-field input,
.assistant-form-field select {
  min-height: 38px;
}
.assistant-form-field input:focus,
.assistant-form-field textarea:focus,
.assistant-form-field select:focus {
  border-color: var(--brand-border-strong);
  box-shadow: 0 0 0 2px var(--brand-ring);
}
.assistant-capability-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.assistant-capability {
  display: flex;
  min-height: 58px;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
  background: var(--brand-surface);
  padding: 9px;
  color: var(--brand-muted-strong);
  font-size: 10px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}
.assistant-capability:hover {
  border-color: var(--brand-border-strong);
  background: var(--brand-surface-subtle);
}
.assistant-capability.is-selected {
  border-color: var(--brand-primary);
  background: color-mix(in srgb, var(--brand-primary) 8%, var(--brand-surface));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand-primary) 25%, transparent);
}
.assistant-capability-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 6px;
  background: var(--brand-surface-subtle);
  color: var(--brand-muted);
}
.assistant-capability.is-selected .assistant-capability-icon {
  border-color: color-mix(in srgb, var(--brand-primary) 35%, var(--brand-border));
  color: var(--brand-primary);
}
.assistant-capability strong {
  display: block;
  color: var(--brand-foreground);
  font-size: 10px;
  font-weight: 680;
}
.assistant-capability small {
  display: block;
  margin-top: 3px;
  color: var(--brand-muted);
  font-size: 9px;
  font-weight: 450;
  line-height: 1.35;
}
.assistant-capability-check {
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  place-items: center;
  border: 1px solid var(--brand-border-strong);
  border-radius: 50%;
  color: var(--brand-primary-foreground);
}
.assistant-capability.is-selected .assistant-capability-check {
  border-color: var(--brand-primary);
  background: var(--brand-primary);
}
.assistant-modal-fade-enter-active,
.assistant-modal-fade-leave-active {
  transition: opacity 180ms ease;
}
.assistant-modal-fade-enter-active .assistant-center-panel,
.assistant-modal-fade-leave-active .assistant-center-panel {
  transition:
    transform 220ms ease,
    opacity 180ms ease;
}
.assistant-modal-fade-enter-from,
.assistant-modal-fade-leave-to {
  opacity: 0;
}
.assistant-modal-fade-enter-from .assistant-center-panel,
.assistant-modal-fade-leave-to .assistant-center-panel {
  opacity: 0;
  transform: translateY(12px) scale(0.985);
}
@media (max-width: 767px) {
  .assistant-center :deep(.assistant-prompt-action) {
    min-height: 44px;
  }
  .assistant-center-mobile-tab,
  .assistant-form-field input,
  .assistant-form-field select {
    min-height: 44px;
  }
  .assistant-modal-fade-enter-from .assistant-center-panel,
  .assistant-modal-fade-leave-to .assistant-center-panel {
    transform: translateY(26px);
  }
}
@media (max-width: 620px) {
  .assistant-capability-grid {
    grid-template-columns: 1fr;
  }
  .assistant-capability {
    min-height: 58px;
  }
}
</style>
