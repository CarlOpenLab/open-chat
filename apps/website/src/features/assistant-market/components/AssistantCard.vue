<script setup lang="ts">
import { ArrowRight, Check, Download, Pencil, Star } from "@lucide/vue";
import { Button } from "antdv-next";
import type { AssistantDefinition } from "../types";
import AssistantIcon from "./AssistantIcon.vue";

interface Props {
  assistant: AssistantDefinition;
  installed: boolean;
  compact?: boolean;
  manageMode?: boolean;
}

interface Emits {
  (e: "view", slug: string): void;
  (e: "use", assistant: AssistantDefinition): void;
  (e: "install", assistant: AssistantDefinition): void;
  (e: "uninstall", assistant: AssistantDefinition): void;
  (e: "edit", assistant: AssistantDefinition): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const formatInstallCount = (count: number) =>
  new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(count);
</script>

<template>
  <article
    class="group flex min-h-[270px] flex-col rounded-[9px] border border-solid border-brand-border bg-brand-surface p-[18px] shadow-brand-xs transition-[border-color,box-shadow,transform] duration-180 hover:-translate-y-[2px] hover:border-brand-border-strong hover:shadow-brand-sm"
    :class="{ 'assistant-card-compact': compact }"
  >
    <div class="flex items-start justify-between gap-4">
      <span
        class="grid h-11 w-11 flex-[0_0_44px] place-items-center rounded-[8px] border border-solid border-brand-border bg-brand-surface-subtle text-brand-foreground"
      >
        <AssistantIcon :name="assistant.icon" class="!h-[19px] !w-[19px]" />
      </span>
      <span
        v-if="assistant.featured"
        class="rounded-full bg-brand-surface-subtle px-[9px] py-[4px] text-[10px] font-650 text-brand-muted-strong"
        >官方精选</span
      >
    </div>

    <div class="mt-[15px] min-w-0">
      <Button
        type="text"
        block
        class="assistant-card-title flex min-h-[30px] w-full items-center gap-2 border-0 bg-transparent p-0 text-left text-brand-foreground lt-md:min-h-11"
        @click="emit('view', assistant.slug)"
      >
        <h2 class="m-0 truncate text-[16px] font-700 leading-[1.35]">{{ assistant.name }}</h2>
        <ArrowRight
          class="!h-[14px] !w-[14px] -translate-x-1 text-brand-muted opacity-0 transition-[opacity,transform] duration-180 group-hover:translate-x-0 group-hover:opacity-100"
        />
      </Button>
      <p class="mt-[7px] mb-0 line-clamp-2 text-[12px] leading-[1.65] text-brand-muted">
        {{ assistant.tagline }}
      </p>
    </div>

    <div class="mt-[13px] flex flex-wrap gap-[6px]">
      <span
        v-for="tag in assistant.tags.slice(0, 3)"
        :key="tag"
        class="rounded-[4px] border border-solid border-brand-border px-[7px] py-[3px] text-[9px] font-600 text-brand-muted"
        >{{ tag }}</span
      >
    </div>

    <div class="assistant-card-footer mt-auto flex items-center justify-between gap-3 pt-[18px]">
      <span class="flex items-center gap-3 text-[10px] text-brand-muted">
        <span class="inline-flex items-center gap-[4px]"
          ><Star class="!h-[12px] !w-[12px] fill-current" />{{ assistant.rating.toFixed(1) }}</span
        >
        <span class="inline-flex items-center gap-[4px]"
          ><Download class="!h-[12px] !w-[12px]" />{{
            formatInstallCount(assistant.installCount)
          }}</span
        >
      </span>
      <div class="flex items-center gap-[6px]">
        <Button
          v-if="manageMode"
          class="text-12px"
          size="small"
          :aria-label="'编辑' + assistant.name"
          @click="emit('edit', assistant)"
        >
          <Pencil class="!h-[13px] !w-[13px]" />编辑
        </Button>
        <Button
          v-else
          class="text-12px"
          size="small"
          :aria-label="(installed ? '卸载' : '安装') + assistant.name"
          @click="installed ? emit('uninstall', assistant) : emit('install', assistant)"
        >
          <span v-if="installed" class="inline-flex items-center gap-[5px]"
            ><Check class="!h-[13px] !w-[13px]" />已安装</span
          >
          <span v-else>安装</span>
        </Button>
        <Button
          class="text-12px"
          size="small"
          type="primary"
          :aria-label="'使用' + assistant.name"
          @click="emit('use', assistant)"
        >
          使用
        </Button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.assistant-card-compact {
  min-height: 232px;
  padding: 14px;
}
.assistant-card-compact .assistant-card-title {
  min-height: 26px;
}
.assistant-card-compact .assistant-card-footer {
  padding-top: 13px;
}
.assistant-card-compact .assistant-card-action {
  min-height: 34px;
  padding-inline: 10px;
}
@media (max-width: 767px) {
  .assistant-card-compact .assistant-card-title,
  .assistant-card-compact .assistant-card-action {
    min-height: 44px;
  }
}
</style>
