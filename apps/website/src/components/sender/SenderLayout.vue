<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import type { SenderProps, SenderRef } from "@antdv-next/x";
import { ChevronLeft, ChevronRight } from "@lucide/vue";
import { ref } from "vue";
import { createStyles } from "../../theme/antdvStyle";
import type { AccentGlobalToken } from "../../theme/shadcnTheme";

/**
 * SenderLayout：消息输入区「外壳」组件。
 *
 * 结构（上 → 下）：
 *   header 浮层（slot #header，card / float 两种变体，可带面板导航箭头）
 *   antdv-x Sender（slot #footer 接管底部工具区，defaultNode 为发送按钮）
 *   底部卡片（slot #bottom，与输入卡片连成一张）
 *
 * 只负责布局与壳层样式，业务面板 / chips / 底部行内容由调用方通过 slots 组合。
 * 注意：slot 内容沿用了壳层的字面量类名作为样式锚点（sender-footer-row、
 * sender-flat-btn、sender-bottom-row 等），移动 slot 内容时保持类名不变。
 */
interface Props {
  // ===== antdv-x Sender 透传（与 SenderProps 一一对应）=====
  value: string;
  loading?: boolean;
  disabled?: boolean;
  skill?: SenderProps["skill"];
  slotConfig?: SenderProps["slotConfig"];
  placeholder?: string;
  /** Sender 交互回调：函数 props 与 antdv-x 风格一致，onKeyDown 返回 false 可阻止本次发送 */
  onChange?: SenderProps["onChange"];
  onSubmit?: SenderProps["onSubmit"];
  onKeyDown?: SenderProps["onKeyDown"];
  onCancel?: SenderProps["onCancel"];
  onPasteFile?: SenderProps["onPasteFile"];
  // ===== 外壳布局 =====
  /** 有底部卡片时输入卡片去掉下圆角，两段视觉连成一张卡片 */
  hasBottomCard?: boolean;
  /** header 浮层变体：card = 壳层白底卡片（队列 / 附件 / 权限面板）；float = 透明悬浮（指令候选等内容自带卡片） */
  headerVariant?: "card" | "float";
  /** header 浮层是否需要左右面板导航箭头（点击经 headerNav 事件上抛） */
  headerNavigable?: boolean;
  /** 拖拽遮罩文案 */
  dropOverlayText?: string;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  disabled: false,
  hasBottomCard: false,
  headerVariant: "card",
  headerNavigable: false,
  placeholder: "输入消息…",
  dropOverlayText: "松开以添加图片",
});

const emit = defineEmits<{
  (e: "headerNav", direction: -1 | 1): void;
  /** 拖拽 / 粘贴等入口汇总的待处理文件（业务侧决定暂存与上传） */
  (e: "dropFiles", files: File[]): void;
}>();

const senderRef = ref<SenderRef | null>(null);

defineExpose({
  focus: (options?: Parameters<SenderRef["focus"]>[0]) => senderRef.value?.focus(options),
  blur: () => senderRef.value?.blur(),
});

// ===== 拖拽上传：dragActive 是壳层 UI 状态，文件经 dropFiles 上抛 =====
const dragActive = ref(false);

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  if (event.dataTransfer?.types.includes("Files")) dragActive.value = true;
};

const handleDragLeave = (event: DragEvent) => {
  if (event.target === event.currentTarget) dragActive.value = false;
};

const handleDrop = (event: DragEvent) => {
  dragActive.value = false;
  const files = event.dataTransfer?.files;
  if (files?.length) {
    event.preventDefault();
    emit("dropFiles", Array.from(files));
  }
};

const useStyles = createStyles(({ token, css }) => {
  const accent = (token as AccentGlobalToken).colorAccent;
  return {
    // 壳层：底部渐变、水平居中内边距；子元素沿用字面量类名作为选择器锚点
    layout: css`
      position: relative;
      z-index: 12;
      padding: 20px max(20px, calc((100% - 760px) / 2)) max(16px, env(safe-area-inset-bottom));
      background: linear-gradient(
        to bottom,
        transparent 0,
        ${token.colorBgLayout} 32px,
        ${token.colorBgLayout} 100%
      );

      /* 对齐 uno.config.ts 的自定义断点：lt-md => max-width 820px，lt-sm => max-width 560px */
      @media (max-width: 820px) {
        padding-left: 18px;
        padding-right: 18px;
      }
      @media (max-width: 560px) {
        padding-left: 10px;
        padding-right: 10px;
      }

      /* wrapper：浮层、Sender、底部卡片的共同定位锚点（max-width 760px 与壳层横向 padding 对齐） */
      .sender-stack {
        position: relative;
        z-index: 3;
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
      }
      /* 浮层：绝对定位锚定 wrapper 顶部（= Sender 顶），底部 28px 探入 Sender，
       * 被 z-index 更高的 .antd-sender-main 盖住一点，形成悬浮叠压感。
       * 偏移量只跟 wrapper 走，外层布局调整不会改变悬浮位置。 */
      .sender-header-card {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 100%;
        margin-bottom: -28px;
        z-index: 2;
        max-height: 360px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 1px solid ${token.colorBorderSecondary};
        border-radius: 16px;
        background: ${token.colorBgContainer};
        padding: 8px 8px 36px;
        box-shadow: ${token.boxShadowSecondary};
      }
      .sender-header-enter-active,
      .sender-header-leave-active {
        max-height: 360px;
        overflow: hidden;
        transition:
          max-height ${token.motionDurationMid} ${token.motionEaseInOut},
          margin-bottom ${token.motionDurationMid} ${token.motionEaseInOut},
          opacity ${token.motionDurationMid} ${token.motionEaseInOut},
          transform ${token.motionDurationMid} ${token.motionEaseInOut},
          padding ${token.motionDurationMid} ${token.motionEaseInOut};
        transform-origin: bottom center;
      }
      .sender-header-enter-from,
      .sender-header-leave-to {
        max-height: 0;
        margin-bottom: 0;
        border-color: transparent;
        opacity: 0;
        padding-top: 0;
        padding-bottom: 0;
      }
      .sender-header-panel {
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
      }
      .sender-header-card.has-navigation {
        /* 基础卡是 column，多面板导航时左右箭头必须切成 row，
         * 否则箭头会堆叠在内容上下并把卡片撑成三倍高 */
        flex-direction: row;
        align-items: center;
        gap: 4px;
      }
      .sender-header-nav {
        display: grid;
        width: 26px;
        height: 34px;
        flex: none;
        place-items: center;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: ${token.colorTextTertiary};
        cursor: pointer;
      }
      .sender-header-nav:hover {
        background: ${token.colorFillTertiary};
        color: ${token.colorText};
      }
      .sender-header-nav-icon {
        width: 16px;
        height: 16px;
      }
      .sender-header-card:not(.has-navigation) .sender-header-panel {
        width: 100%;
      }
      .sender-header-card.has-navigation .sender-header-panel {
        flex: 1;
        min-width: 0;
      }

      /* ===== Sender（antdv-x）内部结构覆写 ===== */
      .antd-sender {
        position: relative;
        z-index: 3;
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
      }
      .antd-sender-main {
        position: relative;
        z-index: 3;
        min-height: 96px;
        padding: 0;
        /* composer 卡片：圆角 13px，border，composer 底色，无重阴影 */
        border: 1px solid ${token.colorBorderSecondary};
        border-radius: 13px;
        background: ${token.colorBgContainer};
        box-shadow: none;
        transition: border-color ${token.motionDurationMid} ${token.motionEaseInOut};
      }
      /* 桌面端底部卡片与输入卡片视觉上连成一张（bottom card 负 margin 叠压） */
      &.has-bottom-card .antd-sender-main {
        border-radius: 13px;
      }
      .antd-sender-main:focus-within {
        border-color: ${token.colorBorder};
      }
      .antd-sender-content {
        min-height: 50px;
        align-items: flex-start;
        padding: 10px 10px 2px;
      }
      .antd-sender-footer {
        min-height: 32px;
        padding: 0 10px 10px;
      }
      textarea {
        max-height: 152px;
        min-height: 36px;
        color: ${token.colorText};
        caret-color: ${accent};
        font-size: 13.5px;
        line-height: 21px;
      }
      textarea::placeholder {
        color: ${token.colorTextTertiary};
        opacity: 1;
      }
      /* 发送按钮：圆形 26px，inverse 底色，无阴影 */
      .antd-sender-actions-btn {
        width: 26px;
        min-width: 26px;
        height: 26px;
        border-radius: 50%;
        background: ${token.colorText};
        color: ${token.colorBgContainer};
        box-shadow: none;
      }
      .antd-sender-actions-btn:disabled {
        background: ${token.colorFill};
        color: ${token.colorTextDisabled};
        opacity: 1;
      }

      /* sender 底部卡片：与上方输入卡片同背景，底部圆角 */
      .sender-bottom-card {
        position: relative;
        z-index: 2;
        width: 100%;
        max-width: 760px;
        min-height: 42px;
        margin: 0 auto;
        border: 1px solid ${token.colorBorderSecondary};
        border-top: 0;
        border-radius: 0 0 13px 13px;
        background: ${token.colorBgContainer};
        padding: 12px 8px 8px;
        box-shadow: none;
        margin-top: -8px;
      }
      .sender-bottom-row {
        display: flex;
        min-height: 24px;
        align-items: center;
        gap: 2px;
      }
      /* ===== footer / bottom slot 共用的扁平按钮（字面量类名锚点） ===== */
      .sender-footer-row {
        display: flex;
        width: 100%;
        min-height: 26px;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .sender-footer-primary,
      .sender-footer-secondary {
        display: flex;
        min-width: 0;
        align-items: center;
      }
      .sender-footer-primary {
        gap: 3px;
      }
      .sender-footer-secondary {
        flex: none;
        gap: 6px;
      }
      /* 扁平按钮（去 tag）：模型 / 项目目录 / Git 分支共用 */
      .sender-flat-btn {
        display: flex;
        height: 24px;
        min-width: 0;
        flex: none;
        align-items: center;
        gap: 6px;
        border: 0;
        border-radius: 7px;
        padding: 0 8px;
        background: transparent;
        color: ${token.colorTextTertiary};
        font-size: 12.5px;
        line-height: 16px;
        cursor: pointer;
        transition:
          background ${token.motionDurationMid} ${token.motionEaseInOut},
          color ${token.motionDurationMid} ${token.motionEaseInOut};
      }
      .sender-flat-btn:hover:not(:disabled) {
        background: ${token.colorFillTertiary};
        color: ${token.colorText};
      }
      .sender-flat-btn:focus-visible {
        outline: 2px solid ${token.controlOutline};
        outline-offset: 1px;
      }
      .sender-flat-btn.is-disabled,
      .sender-flat-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      /* 模型作为主标题，比其余项更醒目 */
      .sender-flat-btn-model {
        color: ${token.colorText};
        font-weight: 500;
      }
      .sender-flat-model-label,
      .sender-flat-label {
        display: block;
        min-width: 0;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sender-flat-model-label {
        max-width: 220px;
      }
      .sender-flat-sep {
        width: 1px;
        height: 16px;
        flex: none;
        margin: 0 4px;
        background: ${token.colorBorderSecondary};
      }
      .sender-flat-project {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 1px;
      }
      .sender-flat-clear {
        display: grid;
        width: 26px;
        height: 26px;
        flex: none;
        place-items: center;
        border: 0;
        border-radius: 6px;
        padding: 0;
        background: transparent;
        color: ${token.colorTextTertiary};
        cursor: pointer;
      }
      .sender-flat-clear:hover:not(:disabled) {
        background: ${token.colorFillTertiary};
        color: ${token.colorText};
      }
      .sender-flat-clear:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      .sender-stop-button {
        display: grid;
        width: 28px;
        height: 28px;
        flex: none;
        place-items: center;
        border: 1px solid ${token.colorError};
        border-radius: 7px;
        padding: 0;
        background: color-mix(in srgb, ${token.colorError} 10%, transparent);
        color: ${token.colorError};
        cursor: pointer;
        transition:
          background ${token.motionDurationMid} ${token.motionEaseInOut},
          color ${token.motionDurationMid} ${token.motionEaseInOut};
      }
      .sender-stop-button:hover {
        background: ${token.colorError};
        color: ${token.colorBgLayout};
      }

      .drop-overlay {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 600;
        color: ${accent};
        background: color-mix(in srgb, ${token.colorBgLayout} 82%, transparent);
        border: 1.5px dashed ${accent};
        border-radius: 13px;
        pointer-events: none;
      }

      @media (max-width: 560px) {
        .antd-sender-main {
          min-height: 102px;
          border-radius: 13px;
        }
        /* 窄屏底部卡片不再叠压，输入卡片真正去掉下圆角与卡片拼接 */
        &.has-bottom-card .antd-sender-main {
          border-radius: 13px 13px 0 0;
        }
        .sender-bottom-card {
          min-height: auto;
        }
        .sender-bottom-row {
          flex-wrap: wrap;
          gap: 2px 4px;
          padding: 2px 0;
        }
        .antd-sender-content {
          padding-inline: 12px;
        }
        .antd-sender-footer {
          padding-inline: 8px;
        }
        textarea {
          font-size: 16px;
        }
        .sender-footer-row {
          flex-wrap: wrap;
          gap: 4px 8px;
        }
        .sender-footer-primary {
          width: 100%;
        }
        .sender-footer-secondary {
          margin-left: auto;
        }
      }
    `,
  };
});

const { styles } = useStyles();
</script>

<template>
  <section
    class="sender-layout"
    :class="[styles.layout, { 'has-bottom-card': hasBottomCard }]"
    aria-label="消息输入区"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- 定位锚点：header 浮层 / Sender / 底部卡片共用一个 wrapper，
         浮层偏移量相对 wrapper 计算，外层布局变化不影响悬浮位置。 -->
    <div class="sender-stack">
      <Transition name="sender-header">
        <div
          v-if="$slots.header"
          class="sender-header-card"
          :class="{
            'has-navigation': headerNavigable,
          }"
        >
          <button
            v-if="headerNavigable"
            type="button"
            class="sender-header-nav sender-header-nav-left"
            aria-label="切换到上一个面板"
            title="上一个面板"
            @click="emit('headerNav', -1)"
          >
            <ChevronLeft class="sender-header-nav-icon" />
          </button>
          <div class="sender-header-panel">
            <slot name="header" />
          </div>
          <button
            v-if="headerNavigable"
            type="button"
            class="sender-header-nav sender-header-nav-right"
            aria-label="切换到下一个面板"
            title="下一个面板"
            @click="emit('headerNav', 1)"
          >
            <ChevronRight class="sender-header-nav-icon" />
          </button>
        </div>
      </Transition>
      <Sender
        ref="senderRef"
        :value="value"
        :slot-config="slotConfig"
        :loading="loading"
        :skill="skill"
        :placeholder="placeholder"
        :disabled="disabled"
        :suffix="false"
        :on-cancel="onCancel"
        :on-change="onChange"
        :on-submit="onSubmit"
        :on-key-down="onKeyDown"
        :on-paste-file="onPasteFile"
      >
        <template #footer="{ defaultNode }">
          <slot name="footer" :default-node="defaultNode" />
        </template>
      </Sender>
      <!-- 底部卡片：与上方输入卡片连成一张；内容由 #bottom slot 组合 -->
      <div v-if="$slots.bottom" class="sender-bottom-card">
        <slot name="bottom" />
      </div>
    </div>
    <div v-if="dragActive" class="drop-overlay">{{ dropOverlayText }}</div>
  </section>
</template>
