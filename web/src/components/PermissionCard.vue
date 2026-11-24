<script setup lang="ts">
import { CheckOutlined, CloseOutlined, SafetyOutlined } from "@antdv-next/icons";
import { Button } from "antdv-next";
import { computed, ref } from "vue";
import { respond } from "../store";
import type { PermissionOption } from "../types";

/** A tool waiting for the user's consent: the one thing that must be hard to miss. */
const props = defineProps<{
  conversationId: string;
  requestId: string;
  options: PermissionOption[];
  title?: string;
  detail?: string;
  resolved?: { optionId: string | null; auto?: boolean };
}>();

const submitting = ref(false);
const isAllow = (o: PermissionOption) => o.kind.startsWith("allow");
const allows = computed(() => props.options.filter(isAllow));
const rejects = computed(() => props.options.filter((o) => !isAllow(o)));

const chosen = computed(() => {
  if (!props.resolved) return null;
  return props.options.find((o) => o.optionId === props.resolved?.optionId) ?? null;
});

async function answer(o: PermissionOption) {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await respond(props.conversationId, props.requestId, o.optionId);
  } finally {
    submitting.value = false;
  }
}

const kindLabel = (o: PermissionOption) =>
  o.kind === "allow_once"
    ? "允许一次"
    : o.kind === "allow_always"
      ? "本会话允许"
      : o.kind === "reject_once"
        ? "拒绝"
        : o.name;
</script>

<template>
  <div
    class="glass-sm mt-2 mb-3 border border-solid"
    :class="
      resolved
        ? 'border-line bg-surface-2 shadow-none px-[10px] py-[6px] rounded-[9px]'
        : 'border-[color-mix(in_srgb,var(--warn)_34%,transparent)] border-l-[3px] border-l-warn bg-[color-mix(in_srgb,var(--warn-soft)_60%,var(--surface))] shadow-card rounded-[11px] px-[13px] py-[11px]'
    "
  >
    <div v-if="resolved" class="flex items-center gap-[7px] text-[12px] text-ink-2 min-w-0">
      <CheckOutlined v-if="chosen && isAllow(chosen)" class="text-ok flex-none" />
      <CloseOutlined v-else class="text-err flex-none" />
      <span class="font-medium text-ink-2 truncate">{{ title || "权限确认" }}</span>
      <span v-if="detail" class="text-[11px] text-ink-3 truncate flex-1 font-mono">{{ detail }}</span>
      <span class="ml-auto text-[11px] text-ink-3 flex-none">
        <template v-if="chosen && isAllow(chosen)">
          已允许{{ resolved.auto ? "（自动）" : "" }}
        </template>
        <template v-else-if="resolved.optionId">已拒绝</template>
        <template v-else>已取消</template>
      </span>
    </div>

    <template v-else>
      <div class="flex gap-[10px] items-start">
        <span class="flex-none w-6 h-6 grid place-items-center rounded-[7px] bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-warn text-[13px]">
          <SafetyOutlined />
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-[13.5px] fw-560 leading-[1.5] text-ink break-words">{{ title || "需要你的确认" }}</div>
          <div v-if="detail" class="text-[11.5px] text-ink-3 mt-[2px] break-all font-mono">{{ detail }}</div>
        </div>
      </div>
      <div class="flex gap-[7px] items-center mt-[10px] pl-[34px]">
        <Button v-for="o in rejects" :key="o.optionId" size="small" :disabled="submitting" @click="answer(o)">
          <template #icon><CloseOutlined /></template>
          {{ kindLabel(o) }}
        </Button>
        <span class="flex-1" />
        <Button
          v-for="o in allows"
          :key="o.optionId"
          size="small"
          type="primary"
          :ghost="o.kind === 'allow_always'"
          :loading="submitting"
          @click="answer(o)"
        >
          <template #icon><CheckOutlined /></template>
          {{ kindLabel(o) }}
        </Button>
      </div>
    </template>
  </div>
</template>
