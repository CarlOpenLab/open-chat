<script setup lang="ts">
import { CheckOutlined, CloseOutlined, SafetyOutlined } from "@antdv-next/icons";
import { Button } from "antdv-next";
import { computed } from "vue";
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

const isAllow = (o: PermissionOption) => o.kind.startsWith("allow");
const allows = computed(() => props.options.filter(isAllow));
const rejects = computed(() => props.options.filter((o) => !isAllow(o)));

const chosen = computed(() => {
  if (!props.resolved) return null;
  return props.options.find((o) => o.optionId === props.resolved?.optionId) ?? null;
});

function answer(o: PermissionOption) {
  void respond(props.conversationId, props.requestId, o.optionId);
}

const kindLabel = (o: PermissionOption) =>
  o.kind === "allow_once" ? "允许一次" : o.kind === "allow_always" ? "本会话都允许" : o.kind === "reject_once" ? "拒绝" : o.name;
</script>

<template>
  <div class="perm" :class="{ resolved }">
    <div class="head">
      <span class="badge"><SafetyOutlined /></span>
      <div class="what">
        <div class="title">{{ title || "需要你的确认" }}</div>
        <div v-if="detail" class="detail mono">{{ detail }}</div>
      </div>
    </div>
    <div v-if="!resolved" class="actions">
      <Button v-for="o in rejects" :key="o.optionId" size="small" @click="answer(o)">
        <template #icon><CloseOutlined /></template>
        {{ kindLabel(o) }}
      </Button>
      <span class="spacer" />
      <Button v-for="o in allows" :key="o.optionId" size="small" type="primary" :ghost="o.kind === 'allow_always'" @click="answer(o)">
        <template #icon><CheckOutlined /></template>
        {{ kindLabel(o) }}
      </Button>
    </div>
    <div v-else class="verdict">
      <template v-if="chosen && isAllow(chosen)">
        <CheckOutlined class="ok" /> 已允许{{ resolved.auto ? "（自动）" : "" }} · {{ kindLabel(chosen) }}
      </template>
      <template v-else-if="resolved.optionId">
        <CloseOutlined class="no" /> 已拒绝 · {{ chosen ? kindLabel(chosen) : "" }}
      </template>
      <template v-else><CloseOutlined class="no" /> 已取消</template>
    </div>
  </div>
</template>

<style scoped>
.perm {
  border: 1px solid color-mix(in srgb, var(--warn) 32%, transparent);
  background: color-mix(in srgb, var(--warn-soft) 70%, var(--surface));
  border-radius: 11px;
  padding: 11px 12px;
  margin: 6px 0 12px;
  box-shadow: 0 1px 0 color-mix(in srgb, var(--warn) 12%, transparent);
}
.perm.resolved {
  border-color: var(--border);
  background: var(--surface-2);
  box-shadow: none;
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
.perm.resolved .badge {
  background: var(--hover);
  color: var(--text-3);
}
.title {
  font-size: 13.5px;
  font-weight: 550;
  line-height: 1.5;
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
.verdict {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-2);
  margin-top: 6px;
  padding-left: 34px;
}
.ok {
  color: var(--ok);
}
.no {
  color: var(--err);
}
</style>
