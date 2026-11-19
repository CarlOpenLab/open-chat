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
  <div class="perm" :class="{ resolved }">
    <div v-if="resolved" class="resolved-row">
      <CheckOutlined v-if="chosen && isAllow(chosen)" class="ok" />
      <CloseOutlined v-else class="no" />
      <span class="resolved-title">{{ title || "权限确认" }}</span>
      <span v-if="detail" class="resolved-detail mono">{{ detail }}</span>
      <span class="resolved-tag">
        <template v-if="chosen && isAllow(chosen)">
          已允许{{ resolved.auto ? "（自动）" : "" }}
        </template>
        <template v-else-if="resolved.optionId">已拒绝</template>
        <template v-else>已取消</template>
      </span>
    </div>

    <template v-else>
      <div class="head">
        <span class="badge"><SafetyOutlined /></span>
        <div class="what">
          <div class="title">{{ title || "需要你的确认" }}</div>
          <div v-if="detail" class="detail mono">{{ detail }}</div>
        </div>
      </div>
      <div class="actions">
        <Button v-for="o in rejects" :key="o.optionId" size="small" :disabled="submitting" @click="answer(o)">
          <template #icon><CloseOutlined /></template>
          {{ kindLabel(o) }}
        </Button>
        <span class="spacer" />
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

<style scoped>
.perm {
  border: 1px solid color-mix(in srgb, var(--warn) 34%, transparent);
  border-left: 3px solid var(--warn);
  background: color-mix(in srgb, var(--warn-soft) 60%, var(--surface));
  backdrop-filter: var(--glass-blur-sm);
  -webkit-backdrop-filter: var(--glass-blur-sm);
  box-shadow: var(--shadow-card);
  border-radius: 11px;
  padding: 11px 13px;
  margin: 8px 0 12px;
}
.perm.resolved {
  border: 1px solid var(--border);
  border-left: 1px solid var(--border);
  background: var(--surface-2);
  box-shadow: none;
  padding: 6px 10px;
  border-radius: 9px;
}
.resolved-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-2);
  min-width: 0;
}
.resolved-title {
  font-weight: 500;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.resolved-detail {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.resolved-tag {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-3);
  flex: none;
}
.head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.badge {
  flex: none;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: color-mix(in srgb, var(--warn) 16%, transparent);
  color: var(--warn);
  font-size: 13px;
}
.what {
  min-width: 0;
  flex: 1;
}
.title {
  font-size: 13.5px;
  font-weight: 560;
  line-height: 1.5;
  color: var(--text);
  word-break: break-word;
}
.detail {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 2px;
  word-break: break-all;
}
.actions {
  display: flex;
  gap: 7px;
  align-items: center;
  margin-top: 10px;
  padding-left: 34px;
}
.spacer {
  flex: 1;
}
.ok {
  color: var(--ok);
  flex: none;
}
.no {
  color: var(--err);
  flex: none;
}
</style>
