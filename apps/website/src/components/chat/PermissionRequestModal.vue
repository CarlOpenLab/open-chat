<script setup lang="ts">
import { ShieldCheck, ShieldQuestion } from "@lucide/vue";
import { Button, Modal } from "antdv-next";
import { computed } from "vue";
import type { PermissionRequest } from "../../services/OpenChatProvider";

interface Props {
  open: boolean;
  request: PermissionRequest | null;
}

interface Emits {
  (e: "allow", response: "once" | "always" | "reject"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const permissionLabel = computed<string>(() => {
  const name = props.request?.permission ?? "";
  switch (name) {
    case "bash":
      return "执行终端命令";
    case "edit":
    case "write":
    case "apply_patch":
      return "修改文件";
    case "webfetch":
      return "访问网页";
    case "web_search":
      return "联网搜索";
    case "read":
      return "读取文件";
    case "task":
      return "创建子任务";
    default:
      return name || "执行操作";
  }
});

const detailLines = computed<string[]>(() => {
  const request = props.request;
  if (!request) return [];
  const lines: string[] = [];
  for (const pattern of request.patterns ?? []) {
    if (pattern) lines.push(pattern);
  }
  const metadata = request.metadata ?? {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "title" || key === "description") continue;
    if (value === undefined || value === null || value === "") continue;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text) lines.push(text);
  }
  return lines;
});
</script>

<template>
  <Modal
    :open="open"
    :footer="null"
    :closable="false"
    :mask-closable="false"
    centered
    :width="440"
    wrap-class-name="permission-dialog-wrap"
  >
    <div v-if="request">
      <span
        class="mb-[14px] grid h-[38px] w-[38px] place-items-center rounded-[6px] bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
      >
        <ShieldQuestion class="h-[18px] w-[18px]" />
      </span>
      <h2 class="m-0 text-[16px]">需要你的授权</h2>
      <p class="mx-0 mb-0 mt-[5px] text-[11px] leading-[1.6] text-brand-muted">
        AI 请求<span class="text-brand-foreground">{{ permissionLabel }}</span
        >。是否允许？
      </p>
      <pre
        v-if="detailLines.length"
        class="permission-detail mb-0 mt-[14px] max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-brand-border bg-brand-surface-subtle px-3 py-2 text-[11px] leading-[1.6] text-brand-foreground"
        >{{ detailLines.join("\n") }}</pre>
      <footer class="mt-[22px] flex flex-wrap justify-end gap-[8px]">
        <Button @click="emit('allow', 'reject')">拒绝</Button>
        <Button @click="emit('allow', 'once')">允许一次</Button>
        <Button type="primary" @click="emit('allow', 'always')">
          <span class="inline-flex items-center gap-1">
            <ShieldCheck class="h-[14px] w-[14px]" />始终允许
          </span>
        </Button>
      </footer>
    </div>
  </Modal>
</template>

<style scoped>
/* :global() 覆盖 wrap-class-name 挂载的 antd Modal 结构，保留 */
:global(.permission-dialog-wrap .ant-modal-container) {
  padding: 20px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
}

@media (max-width: 560px) {
  :global(.permission-dialog-wrap .ant-modal-container) {
    border-width: 1px 0 0;
    border-radius: 8px 8px 0 0;
  }
  :global(.permission-dialog-wrap .ant-modal) {
    max-width: 100%;
    margin: 0;
    padding-bottom: 0;
    top: auto;
  }
}
</style>
