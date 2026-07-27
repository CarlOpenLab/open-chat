<script setup lang="ts">
import {
  ArrowLeft,
  Bot,
  Check,
  Download,
  Moon,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  UserRound,
} from "@lucide/vue";
import { message } from "antdv-next";
import { computed, ref } from "vue";
import {
  ASSISTANT_CATEGORIES,
  OFFICIAL_ASSISTANTS,
  getAssistantBySlug,
} from "../features/assistant-market/catalog";
import AssistantCard from "../features/assistant-market/components/AssistantCard.vue";
import AssistantIcon from "../features/assistant-market/components/AssistantIcon.vue";
import type { AssistantCategory, AssistantDefinition } from "../features/assistant-market/types";
import { useAssistantInstallations } from "../features/assistant-market/useAssistantInstallations";

interface Props {
  dark: boolean;
  routePath: string;
}

interface Emits {
  (e: "navigate", path: string): void;
  (e: "toggleTheme"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const searchQuery = ref("");
const activeCategory = ref<"全部" | AssistantCategory>("全部");
const { installedAssistantIds, hydrating, isInstalled, install, uninstall } =
  useAssistantInstallations();

const pathname = computed(() => props.routePath.split("?")[0].replace(/\/$/, ""));
const isInstalledView = computed(() => pathname.value === "/assistants/installed");
const detailSlug = computed(() => {
  if (pathname.value === "/assistants" || isInstalledView.value) return "";
  return decodeURIComponent(pathname.value.slice("/assistants/".length));
});
const selectedAssistant = computed(() =>
  detailSlug.value ? getAssistantBySlug(detailSlug.value) : undefined,
);

const visibleAssistants = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  return OFFICIAL_ASSISTANTS.filter((assistant) => {
    if (isInstalledView.value && !installedAssistantIds.value.includes(assistant.id)) return false;
    if (activeCategory.value !== "全部" && assistant.category !== activeCategory.value)
      return false;
    if (!query) return true;
    return [assistant.name, assistant.tagline, assistant.description, ...assistant.tags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });
});

const featuredAssistant = OFFICIAL_ASSISTANTS.find(
  (assistant) => assistant.slug === "product-strategist",
)!;
const capabilityLabels = {
  a2ui: "交互界面",
  files: "文件工作区",
  "web-search": "联网搜索",
};
const formatInstallCount = (count: number) =>
  new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(count);

const handleInstall = async (assistant: AssistantDefinition) => {
  await install(assistant.id);
  message.success("已安装「" + assistant.name + "」");
};

const handleUninstall = async (assistant: AssistantDefinition) => {
  await uninstall(assistant.id);
  message.success("已从我的助手中移除「" + assistant.name + "」");
};

const handleUse = async (assistant: AssistantDefinition, starterPromptId?: string) => {
  await install(assistant.id);
  const params = new URLSearchParams({ assistant: assistant.id });
  if (starterPromptId) params.set("starter", starterPromptId);
  emit("navigate", "/chat?" + params.toString());
};
</script>

<template>
  <main class="min-h-[100dvh] bg-brand-background text-brand-foreground">
    <a class="skip-link" href="#assistant-market-content">跳到助手内容</a>
    <header
      class="sticky top-0 z-20 border-b border-b-solid border-brand-border bg-[color-mix(in_srgb,var(--brand-background)_92%,transparent)] backdrop-blur-[18px]"
    >
      <div class="mx-auto flex min-h-[62px] max-w-[1180px] items-center gap-4 px-6 lt-md:px-4">
        <button
          type="button"
          class="flex min-h-11 items-center gap-[9px] border-0 bg-transparent p-0 text-brand-foreground"
          aria-label="返回 Open Chat 工作区"
          @click="emit('navigate', '/chat')"
        >
          <span
            class="grid h-8 w-8 place-items-center rounded-[6px] bg-brand-primary text-brand-primary-foreground"
            ><Sparkles class="!h-[15px] !w-[15px]"
          /></span>
          <strong class="text-[14px] font-700 lt-sm:hidden">Open Chat</strong>
        </button>

        <nav class="ml-auto flex items-center gap-1" aria-label="助手市场导航">
          <button
            type="button"
            class="min-h-11 whitespace-nowrap rounded-[6px] border-0 px-3 text-[12px] font-620"
            :class="
              !isInstalledView && !detailSlug
                ? 'bg-brand-surface-subtle text-brand-foreground'
                : 'bg-transparent text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground'
            "
            @click="emit('navigate', '/assistants')"
          >
            助手市场
          </button>
          <button
            type="button"
            class="min-h-11 whitespace-nowrap rounded-[6px] border-0 px-3 text-[12px] font-620"
            :class="
              isInstalledView
                ? 'bg-brand-surface-subtle text-brand-foreground'
                : 'bg-transparent text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground'
            "
            @click="emit('navigate', '/assistants/installed')"
          >
            我的助手
          </button>
          <button
            type="button"
            class="ml-1 grid h-11 w-11 place-items-center rounded-[6px] border-0 bg-transparent text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground"
            :aria-label="props.dark ? '切换浅色模式' : '切换深色模式'"
            @click="emit('toggleTheme')"
          >
            <Sun v-if="props.dark" /><Moon v-else />
          </button>
        </nav>
      </div>
    </header>

    <div
      id="assistant-market-content"
      class="mx-auto max-w-[1180px] px-6 py-10 lt-md:px-4 lt-md:py-7"
    >
      <template v-if="selectedAssistant">
        <button
          type="button"
          class="mb-7 inline-flex min-h-11 items-center gap-2 border-0 bg-transparent px-0 text-[12px] font-620 text-brand-muted hover:text-brand-foreground"
          @click="emit('navigate', '/assistants')"
        >
          <ArrowLeft class="!h-[15px] !w-[15px]" />返回助手市场
        </button>

        <section class="grid grid-cols-[minmax(0,1fr)_320px] gap-10 lt-lg:grid-cols-1 lt-lg:gap-7">
          <div class="min-w-0">
            <div class="flex items-start gap-5 lt-sm:flex-col">
              <span
                class="grid h-16 w-16 flex-[0_0_64px] place-items-center rounded-[12px] border border-solid border-brand-border bg-brand-surface-subtle"
              >
                <AssistantIcon :name="selectedAssistant.icon" class="!h-7 !w-7" />
              </span>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h1 class="m-0 text-[32px] font-750 leading-[1.2] lt-sm:text-[27px]">
                    {{ selectedAssistant.name }}
                  </h1>
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-brand-surface-subtle px-2 py-1 text-[9px] font-650 text-brand-muted-strong"
                    ><ShieldCheck class="!h-3 !w-3" />官方</span
                  >
                </div>
                <p class="mt-3 mb-0 max-w-[720px] text-[15px] leading-[1.7] text-brand-muted">
                  {{ selectedAssistant.tagline }}
                </p>
                <div class="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-brand-muted">
                  <span class="inline-flex items-center gap-[5px]"
                    ><UserRound class="!h-3.5 !w-3.5" />{{ selectedAssistant.author }}</span
                  >
                  <span class="inline-flex items-center gap-[5px]"
                    ><Star class="!h-3.5 !w-3.5 fill-current" />{{
                      selectedAssistant.rating.toFixed(1)
                    }}</span
                  >
                  <span class="inline-flex items-center gap-[5px]"
                    ><Download class="!h-3.5 !w-3.5" />{{
                      formatInstallCount(selectedAssistant.installCount)
                    }}
                    次安装</span
                  >
                </div>
              </div>
            </div>

            <div class="mt-10 border-t border-t-solid border-brand-border pt-8">
              <h2 class="m-0 text-[17px] font-700">关于这个助手</h2>
              <p class="mt-3 mb-0 max-w-[780px] text-[13px] leading-[1.85] text-brand-muted-strong">
                {{ selectedAssistant.description }}
              </p>
            </div>

            <div class="mt-9">
              <h2 class="m-0 text-[17px] font-700">试试这样开始</h2>
              <div class="mt-4 grid grid-cols-3 gap-3 lt-md:grid-cols-1">
                <button
                  v-for="prompt in selectedAssistant.starterPrompts"
                  :key="prompt.id"
                  type="button"
                  class="min-h-[108px] rounded-[8px] border border-solid border-brand-border bg-brand-surface p-4 text-left hover:border-brand-border-strong hover:bg-brand-surface-muted"
                  @click="handleUse(selectedAssistant, prompt.id)"
                >
                  <strong class="block text-[12px] font-650">{{ prompt.label }}</strong>
                  <span class="mt-2 block text-[10px] leading-[1.6] text-brand-muted">{{
                    prompt.description
                  }}</span>
                </button>
              </div>
            </div>
          </div>

          <aside
            class="h-fit rounded-[10px] border border-solid border-brand-border bg-brand-surface p-5 shadow-brand-xs lt-lg:max-w-[520px]"
            aria-label="助手安装信息"
          >
            <button
              type="button"
              class="min-h-12 w-full rounded-[7px] border border-solid border-brand-primary bg-brand-primary px-4 text-[13px] font-700 text-brand-primary-foreground hover:bg-brand-primary-hover"
              @click="handleUse(selectedAssistant)"
            >
              使用此助手
            </button>
            <button
              type="button"
              class="mt-2 min-h-11 w-full rounded-[7px] border border-solid border-brand-border bg-transparent px-4 text-[12px] font-620 text-brand-foreground hover:bg-brand-surface-subtle"
              @click="
                isInstalled(selectedAssistant.id)
                  ? handleUninstall(selectedAssistant)
                  : handleInstall(selectedAssistant)
              "
            >
              <span v-if="isInstalled(selectedAssistant.id)" class="inline-flex items-center gap-2"
                ><Check class="!h-[14px] !w-[14px]" />已安装到我的助手</span
              >
              <span v-else>安装到我的助手</span>
            </button>

            <dl class="mt-6 mb-0 grid gap-4 border-t border-t-solid border-brand-border pt-5">
              <div class="flex items-center justify-between gap-4">
                <dt class="text-[10px] text-brand-muted">版本</dt>
                <dd class="m-0 text-[11px] font-620">v{{ selectedAssistant.version }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4">
                <dt class="text-[10px] text-brand-muted">更新日期</dt>
                <dd class="m-0 text-[11px] font-620">{{ selectedAssistant.updatedAt }}</dd>
              </div>
              <div class="flex items-start justify-between gap-4">
                <dt class="pt-[2px] text-[10px] text-brand-muted">所需能力</dt>
                <dd class="m-0 flex max-w-[190px] flex-wrap justify-end gap-1.5 text-right">
                  <span
                    v-if="selectedAssistant.capabilities.length === 0"
                    class="text-[11px] font-620"
                    >无</span
                  >
                  <span
                    v-for="capability in selectedAssistant.capabilities"
                    :key="capability"
                    class="rounded-[4px] bg-brand-surface-subtle px-2 py-1 text-[9px] font-620"
                    >{{ capabilityLabels[capability] }}</span
                  >
                </dd>
              </div>
            </dl>
          </aside>
        </section>
      </template>

      <template v-else-if="detailSlug">
        <section class="grid min-h-[55vh] place-items-center text-center">
          <div>
            <Bot class="mx-auto !h-8 !w-8 text-brand-muted" />
            <h1 class="mt-5 mb-2 text-[24px]">没有找到这个助手</h1>
            <p class="m-0 text-[12px] text-brand-muted">它可能已更名或暂时下架。</p>
            <button
              type="button"
              class="mt-6 min-h-11 rounded-[6px] border border-solid border-brand-border bg-brand-surface px-4 text-[12px] font-620"
              @click="emit('navigate', '/assistants')"
            >
              返回市场
            </button>
          </div>
        </section>
      </template>

      <template v-else>
        <section
          v-if="!isInstalledView"
          class="grid grid-cols-[minmax(0,1fr)_360px] items-end gap-10 border-b border-b-solid border-brand-border pb-9 lt-md:grid-cols-1 lt-md:gap-6"
        >
          <div>
            <p class="m-0 text-[10px] font-700 uppercase tracking-[0.14em] text-brand-muted">
              Open Chat Assistants
            </p>
            <h1
              class="mt-4 mb-0 max-w-[660px] text-[38px] font-760 leading-[1.18] tracking-[-0.035em] lt-md:text-[31px]"
            >
              为每一种工作，选择更专业的 AI 助手
            </h1>
            <p class="mt-4 mb-0 max-w-[620px] text-[14px] leading-[1.75] text-brand-muted">
              安装由 Open Chat 精选的版本化助手。每个助手都有明确职责、开场方式和能力边界。
            </p>
          </div>
          <button
            type="button"
            class="group flex min-h-[126px] items-center gap-4 rounded-[9px] border border-solid border-brand-border bg-brand-surface p-4 text-left shadow-brand-xs hover:border-brand-border-strong hover:shadow-brand-sm"
            @click="emit('navigate', '/assistants/' + featuredAssistant.slug)"
          >
            <span
              class="grid h-12 w-12 flex-[0_0_48px] place-items-center rounded-[8px] bg-brand-primary text-brand-primary-foreground"
              ><AssistantIcon :name="featuredAssistant.icon" class="!h-5 !w-5"
            /></span>
            <span class="min-w-0">
              <small class="text-[9px] font-700 uppercase tracking-[0.1em] text-brand-muted"
                >本周精选</small
              >
              <strong class="mt-1 block text-[13px]">{{ featuredAssistant.name }}</strong>
              <span class="mt-1 block text-[10px] leading-[1.5] text-brand-muted">{{
                featuredAssistant.tagline
              }}</span>
            </span>
          </button>
        </section>

        <section :class="isInstalledView ? '' : 'pt-8'">
          <div v-if="isInstalledView" class="mb-8">
            <p class="m-0 text-[10px] font-700 uppercase tracking-[0.14em] text-brand-muted">
              Personal Library
            </p>
            <h1 class="mt-3 mb-0 text-[32px] font-750 tracking-[-0.025em]">我的助手</h1>
            <p class="mt-2 mb-0 text-[12px] text-brand-muted">你安装的助手会保存在当前设备。</p>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <label class="relative min-w-[260px] flex-1" for="assistant-search">
              <Search
                class="pointer-events-none absolute left-3 top-1/2 !h-[15px] !w-[15px] -translate-y-1/2 text-brand-muted"
              />
              <input
                id="assistant-search"
                v-model="searchQuery"
                type="search"
                aria-label="搜索助手"
                class="h-11 w-full rounded-[7px] border border-solid border-brand-border bg-brand-surface pl-9 pr-3 text-[12px] text-brand-foreground outline-0 placeholder:text-brand-muted focus:border-brand-border-strong focus:shadow-[0_0_0_2px_var(--brand-ring)] lt-md:text-[16px]"
                placeholder="搜索助手、能力或场景"
                autocomplete="off"
              />
            </label>
            <div class="flex max-w-full gap-1 overflow-x-auto py-1" aria-label="助手分类">
              <button
                v-for="category in ASSISTANT_CATEGORIES"
                :key="category"
                type="button"
                class="min-h-10 flex-none rounded-[6px] border border-solid px-3 text-[11px] font-620 lt-md:min-h-11"
                :class="
                  activeCategory === category
                    ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground'
                    : 'border-brand-border bg-brand-surface text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground'
                "
                :aria-pressed="activeCategory === category"
                @click="activeCategory = category"
              >
                {{ category }}
              </button>
            </div>
          </div>

          <div
            v-if="hydrating"
            class="grid min-h-[260px] place-items-center text-[12px] text-brand-muted"
          >
            正在读取助手库…
          </div>
          <div
            v-else-if="visibleAssistants.length > 0"
            class="mt-6 grid grid-cols-3 gap-4 lt-lg:grid-cols-2 lt-md:grid-cols-1"
          >
            <AssistantCard
              v-for="assistant in visibleAssistants"
              :key="assistant.id"
              :assistant="assistant"
              :installed="isInstalled(assistant.id)"
              @view="emit('navigate', '/assistants/' + $event)"
              @use="handleUse"
              @install="handleInstall"
              @uninstall="handleUninstall"
            />
          </div>
          <div
            v-else
            class="mt-6 grid min-h-[280px] place-items-center rounded-[9px] border border-dashed border-brand-border text-center"
          >
            <div>
              <Bot class="mx-auto !h-7 !w-7 text-brand-muted" />
              <strong class="mt-4 block text-[13px]">{{
                isInstalledView ? "还没有安装助手" : "没有匹配的助手"
              }}</strong>
              <p class="mt-1 mb-0 text-[10px] text-brand-muted">
                {{ isInstalledView ? "去市场挑选一个适合你的助手。" : "换个关键词或分类试试。" }}
              </p>
              <button
                v-if="isInstalledView"
                type="button"
                class="mt-5 min-h-11 rounded-[6px] border border-solid border-brand-primary bg-brand-primary px-4 text-[11px] font-650 text-brand-primary-foreground"
                @click="emit('navigate', '/assistants')"
              >
                浏览助手市场
              </button>
            </div>
          </div>
        </section>
      </template>
    </div>
  </main>
</template>
