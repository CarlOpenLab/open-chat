<script setup lang="ts">
import { Trash2 } from "@lucide/vue";
import { Button, Modal } from "antdv-next";

interface Props {
  open: boolean;
}

interface Emits {
  (e: "update:open", value: boolean): void;
  (e: "confirm", event: MouseEvent): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();
</script>

<template>
  <Modal
    :open="open"
    :footer="null"
    centered
    :width="410"
    wrap-class-name="delete-dialog-wrap"
    @update:open="emit('update:open', $event)"
  >
    <div>
      <span
        class="mb-[14px] grid h-[38px] w-[38px] place-items-center rounded-[6px] bg-brand-danger-subtle text-brand-danger"
        ><Trash2 class="w-[17px] h-[17px]"
      /></span>
      <h2 class="m-0 text-[16px]">删除这段对话？</h2>
      <p class="mx-0 mb-0 mt-[5px] text-[11px] leading-[1.6] text-brand-muted">
        删除后无法恢复，对话中的消息和本地记录都会被移除。
      </p>
      <footer class="mt-[22px] flex justify-end gap-[8px]">
        <Button @click="emit('update:open', false)">取消</Button
        ><Button danger type="primary" @click="emit('confirm', $event)">删除对话</Button>
      </footer>
    </div>
  </Modal>
</template>

<style scoped>
/* :global() 覆盖 wrap-class-name 挂载的 antd Modal 结构，保留 */
:global(.delete-dialog-wrap .ant-modal-container) {
  padding: 20px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
}

@media (max-width: 560px) {
  :global(.delete-dialog-wrap .ant-modal-container) {
    border-width: 1px 0 0;
    border-radius: 8px 8px 0 0;
  }
  :global(.delete-dialog-wrap .ant-modal) {
    max-width: 100%;
    margin: 0;
    padding-bottom: 0;
    top: auto;
  }
}
</style>
