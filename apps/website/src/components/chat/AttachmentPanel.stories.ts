import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { StagedAttachment } from "../../composables/useComposerData";
import AttachmentPanel from "./AttachmentPanel.vue";

/**
 * 本地占位图（内联 data URI）：故事不发起任何网络请求，
 * 只用于展示 64px 缩略图在亮 / 暗主题下的容器表现。
 */
const placeholder =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23a1a1aa'/%3E%3Cpath d='M14 46l13-16 9 10 6-8 8 14z' fill='%23f4f4f5'/%3E%3C/svg%3E";

const shot: StagedAttachment = {
  sourceKey: "shot.png:1024:1",
  reference: "cc-attachment:shot",
  name: "shot.png",
  isImage: true,
  previewUrl: placeholder,
  uploading: false,
  path: "/tmp/shot.png",
};

const diff: StagedAttachment = {
  sourceKey: "diff.png:2048:2",
  reference: "cc-attachment:diff",
  name: "diff.png",
  isImage: true,
  previewUrl: placeholder,
  uploading: false,
  path: "/tmp/diff.png",
};

const uploading: StagedAttachment = {
  sourceKey: "uploading.png:4096:3",
  reference: "",
  name: "uploading.png",
  isImage: true,
  previewUrl: placeholder,
  uploading: true,
};

const failed: StagedAttachment = {
  sourceKey: "failed.png:8192:4",
  reference: "",
  name: "failed.png",
  isImage: true,
  previewUrl: placeholder,
  uploading: false,
  error: "网关不可用",
};

const uploaded: StagedAttachment[] = [shot, diff];
const mixed: StagedAttachment[] = [shot, uploading, failed];

const meta: Meta<typeof AttachmentPanel> = {
  title: "chat/AttachmentPanel",
  component: AttachmentPanel,
  args: {
    attachments: uploaded,
  },
  render: (args) => ({
    components: { AttachmentPanel },
    setup: () => ({ args }),
    template: `<div style="max-width: 640px; padding: 12px;"><AttachmentPanel v-bind="args" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 已上传：两张缩略图，可单张移除，尾部保留添加入口。 */
export const Uploaded: Story = {};

/** 上传中 / 失败：缩略图盖层分别展示「上传中…」与「上传失败」。 */
export const Uploading: Story = {
  args: { attachments: mixed },
};
