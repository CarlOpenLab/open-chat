<script setup lang="ts">
import { Copy } from "@lucide/vue";
import { Button, Input, Modal, Switch, message } from "antdv-next";
import { ref } from "vue";

interface Props {
  open: boolean;
}

interface Emits {
  (e: "update:open", value: boolean): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const allowSharedCopy = ref(true);

const copyShareLink = async () => {
  try {
    await navigator.clipboard.writeText("https://openchat.dev/share/current");
    message.success("分享链接已复制");
  } catch {
    message.warning("无法访问剪贴板，请手动复制");
  }
};

const handleFinish = () => {
  emit("update:open", false);
  message.success("分享设置已保存");
};
</script>

<template>
  <Modal
    :open="open"
    :footer="null"
    centered
    :width="470"
    wrap-class-name="share-dialog-wrap"
    @update:open="emit('update:open', $event)"
  >
    <div>
      <header>
        <h2 class="m-0 text-[16px]">分享这段对话</h2>
        <p class="mx-0 mb-0 mt-[5px] text-[11px] text-brand-muted">
          拥有链接的人可以查看当前内容。
        </p>
      </header>
      <label class="share-link-field mt-[22px] flex flex-col gap-[7px] text-[10px] font-600"
        ><span>公开链接</span
        ><Input readonly value="https://openchat.dev/share/current"
          ><template #suffix
            ><Button size="small" @click="copyShareLink"
              ><Copy class="w-[12px] h-[12px]" />复制</Button
            ></template
          ></Input
        ></label
      >
      <div
        class="permission-row mt-[14px] grid min-h-[62px] grid-cols-[minmax(0,1fr)_34px] items-center gap-[14px] border-t border-t-solid border-t-brand-border pt-[14px]"
      >
        <span class="flex flex-col"
          ><strong class="text-[10px]">允许继续对话</strong
          ><small class="text-[9px] text-brand-muted">访客可以从分享内容创建副本</small></span
        ><Switch v-model:checked="allowSharedCopy" />
      </div>
      <footer class="mt-[22px] flex justify-end gap-[8px]">
        <Button @click="emit('update:open', false)">取消</Button
        ><Button type="primary" @click="handleFinish">完成</Button>
      </footer>
    </div>
  </Modal>
</template>

<style scoped>
/* :deep() 覆盖 antd 组件内部类，无法用工具类表达，保留 */
.share-link-field :deep(.ant-input-affix-wrapper) {
  min-height: 42px;
  margin-top: 7px;
}
.share-link-field :deep(.ant-btn) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.permission-row :deep(.ant-switch) {
  position: relative;
  min-width: 44px;
}
.permission-row :deep(.ant-switch)::after {
  position: absolute;
  inset: -11px 0;
  content: "";
}

/* :global() 覆盖 wrap-class-name 挂载的 antd Modal 结构，保留 */
:global(.share-dialog-wrap .ant-modal-content) {
  padding: 20px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
}
:global(.share-dialog-wrap .ant-modal-close) {
  top: 13px;
  right: 13px;
}

@media (max-width: 560px) {
  :global(.share-dialog-wrap .ant-modal) {
    max-width: 100%;
    margin: 0;
    padding-bottom: 0;
    top: auto;
  }
  :global(.share-dialog-wrap .ant-modal-wrap) {
    display: flex;
    align-items: flex-end;
  }
  :global(.share-dialog-wrap .ant-modal-content) {
    border-width: 1px 0 0;
    border-radius: 8px 8px 0 0;
  }
}
</style>
