<script setup lang="ts">
import {
  XCardBox,
  XCardCard,
  registerCatalog,
  type ActionPayload,
  type Catalog,
  type XCardCommand,
} from "@antdv-next/x-card";
import {
  Alert,
  Button,
  Card,
  Divider,
  Flex,
  Input,
  Progress,
  Skeleton,
  Statistic,
  Tag,
  TypographyText,
  TypographyTitle,
} from "antdv-next";
import { createA2UIDataModelSnapshot } from "../../utils/a2ui";
import {
  computed,
  defineComponent,
  h,
  inject,
  provide,
  reactive,
  watch,
  type Component,
  type ComputedRef,
  type InjectionKey,
  type PropType,
} from "vue";

interface Props {
  commands: XCardCommand[];
  errors?: string[];
  pending?: boolean;
  actionPending?: boolean;
}

interface Emits {
  (e: "action", payload: ActionPayload): void;
}

interface A2UIAction {
  event?: {
    name?: string;
    context?: Record<string, unknown>;
  };
}

type A2UIInputValues = Record<string, Record<string, unknown>>;

const A2UIInputValuesKey: InjectionKey<A2UIInputValues> = Symbol("OpenChatA2UIInputValues");
const A2UIActionPendingKey: InjectionKey<ComputedRef<boolean>> = Symbol(
  "OpenChatA2UIActionPending",
);

const props = withDefaults(defineProps<Props>(), {
  errors: () => [],
  pending: false,
  actionPending: false,
});
const emit = defineEmits<Emits>();
const inputValues = reactive<A2UIInputValues>({});
provide(A2UIInputValuesKey, inputValues);
provide(
  A2UIActionPendingKey,
  computed(() => props.actionPending),
);

let processedCommandCount = 0;
watch(
  () => props.commands.length,
  (commandCount) => {
    if (commandCount < processedCommandCount) {
      Object.keys(inputValues).forEach((surfaceId) => delete inputValues[surfaceId]);
      processedCommandCount = 0;
    }

    props.commands.slice(processedCommandCount).forEach((command) => {
      if (!("updateDataModel" in command)) return;
      const { surfaceId, path, value } = command.updateDataModel;
      const surfaceValues = inputValues[surfaceId];
      if (surfaceValues && path in surfaceValues) surfaceValues[path] = value;
    });
    processedCommandCount = commandCount;
  },
  { immediate: true },
);

const surfaceIds = computed(() => {
  const ids = new Set<string>();
  props.commands.forEach((command) => {
    if ("createSurface" in command) ids.add(command.createSurface.surfaceId);
    if ("deleteSurface" in command) ids.delete(command.deleteSurface.surfaceId);
  });
  return [...ids];
});

const A2UI_INTERNAL_PATH_PREFIX = "a2ui-path:";

const displayText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
};

const layoutValue = (value: unknown, fallback: string) =>
  typeof value === "string" && /^[a-zA-Z-]+$/.test(value) ? value : fallback;

const A2UIText = defineComponent({
  name: "OpenChatA2UIText",
  props: {
    text: { type: [String, Number, Boolean] as PropType<string | number | boolean> },
    variant: { type: String, default: "body" },
    strong: Boolean,
  },
  setup(componentProps) {
    return () => {
      const content = displayText(componentProps.text);
      const headingLevels: Record<string, 3 | 4 | 5> = {
        h1: 3,
        h2: 4,
        h3: 5,
        h4: 5,
      };
      const level = headingLevels[componentProps.variant];

      if (level) {
        return h(TypographyTitle, { level, class: "a2ui-title" }, { default: () => content });
      }

      const textTypes = {
        caption: "secondary",
        secondary: "secondary",
        success: "success",
        warning: "warning",
        danger: "danger",
      } as const;
      const type = textTypes[componentProps.variant as keyof typeof textTypes];

      return h(
        TypographyText,
        { class: "a2ui-copy", strong: componentProps.strong, type },
        { default: () => content },
      );
    };
  },
});

const createLayoutComponent = (name: string, direction: "row" | "column") =>
  defineComponent({
    name,
    props: {
      align: String,
      justify: String,
      gap: { type: [String, Number] as PropType<string | number>, default: 12 },
      wrap: { type: Boolean, default: true },
    },
    setup(componentProps, { slots }) {
      return () =>
        h(
          Flex,
          {
            class: "a2ui-layout",
            vertical: direction === "column",
            wrap: direction === "row" && componentProps.wrap,
            align: layoutValue(componentProps.align, direction === "row" ? "center" : "stretch"),
            justify: layoutValue(componentProps.justify, "flex-start"),
            gap: componentProps.gap,
          },
          { default: () => slots.default?.() },
        );
    },
  });

const A2UIColumn = createLayoutComponent("OpenChatA2UIColumn", "column");
const A2UIRow = createLayoutComponent("OpenChatA2UIRow", "row");

const A2UITextField = defineComponent({
  name: "OpenChatA2UITextField",
  props: {
    value: { type: [String, Number, Boolean] as PropType<string | number | boolean> },
    label: { type: String, default: "" },
    placeholder: { type: String, default: "" },
    disabled: Boolean,
    __a2uiSurfaceId: { type: String, default: "" },
    __a2uiValuePath: { type: String, default: "" },
    onDataChange: Function as PropType<(path: string, value: unknown) => void>,
  },
  setup(componentProps) {
    const values = inject(A2UIInputValuesKey, {});
    const currentValue = computed(() => displayText(componentProps.value));
    const valuePath = computed(() =>
      componentProps.__a2uiValuePath.startsWith(A2UI_INTERNAL_PATH_PREFIX)
        ? componentProps.__a2uiValuePath.slice(A2UI_INTERNAL_PATH_PREFIX.length)
        : "",
    );

    const getSurfaceValues = () => {
      const surfaceId = componentProps.__a2uiSurfaceId;
      if (!surfaceId) return null;
      values[surfaceId] ??= {};
      return values[surfaceId];
    };

    watch(
      () => [valuePath.value, componentProps.value] as const,
      ([path, value]) => {
        const surfaceValues = getSurfaceValues();
        if (surfaceValues && path) surfaceValues[path] = value;
      },
      { immediate: true },
    );

    const handleChange = (value: string) => {
      const surfaceValues = getSurfaceValues();
      if (!surfaceValues || !valuePath.value) return;
      surfaceValues[valuePath.value] = value;
      componentProps.onDataChange?.(valuePath.value, value);
    };

    return () =>
      h(
        Flex,
        { class: "a2ui-field", vertical: true, gap: 6 },
        {
          default: () => [
            componentProps.label &&
              h(
                TypographyText,
                { class: "a2ui-field-label", strong: true },
                { default: () => componentProps.label },
              ),
            h(Input, {
              value: currentValue.value,
              disabled: componentProps.disabled,
              placeholder: componentProps.placeholder,
              "aria-label": componentProps.label || componentProps.placeholder || "Input",
              "onUpdate:value": (value: unknown) => handleChange(displayText(value)),
            }),
          ],
        },
      );
  },
});

const A2UIDivider = defineComponent({
  name: "OpenChatA2UIDivider",
  props: { axis: { type: String, default: "horizontal" } },
  setup(componentProps) {
    return () =>
      h(Divider, {
        class: "a2ui-divider",
        size: "small",
        vertical: componentProps.axis === "vertical",
      });
  },
});

const A2UIButton = defineComponent({
  name: "OpenChatA2UIButton",
  props: {
    action: Object as PropType<A2UIAction>,
    disabled: Boolean,
    loading: Boolean,
    danger: Boolean,
    size: { type: String as PropType<"small" | "middle" | "large">, default: "middle" },
    variant: { type: String, default: "default" },
    __a2uiSurfaceId: { type: String, default: "" },
    onAction: Function as PropType<(name: string, context: Record<string, unknown>) => void>,
  },
  setup(componentProps, { slots }) {
    const values = inject(A2UIInputValuesKey, {});
    const actionPending = inject(
      A2UIActionPendingKey,
      computed(() => false),
    );
    const handleClick = () => {
      const name = componentProps.action?.event?.name;
      if (!name || actionPending.value) return;
      const surfaceValues = values[componentProps.__a2uiSurfaceId] ?? {};
      const configuredContext = Object.fromEntries(
        Object.entries(componentProps.action?.event?.context ?? {}).map(([key, value]) => {
          if (
            value &&
            typeof value === "object" &&
            "path" in value &&
            typeof value.path === "string"
          ) {
            return [key, surfaceValues[value.path]];
          }
          return [key, value];
        }),
      );
      const hasConfiguredValues = Object.values(configuredContext).some(
        (value) => value !== undefined,
      );
      const context = hasConfiguredValues
        ? configuredContext
        : createA2UIDataModelSnapshot(surfaceValues);
      componentProps.onAction?.(name, context);
    };

    return () =>
      h(
        Button,
        {
          danger: componentProps.danger,
          disabled: componentProps.disabled || actionPending.value,
          loading: componentProps.loading || actionPending.value,
          size: componentProps.size,
          type: ["primary", "text", "link"].includes(componentProps.variant)
            ? (componentProps.variant as "primary" | "text" | "link")
            : "default",
          onClick: handleClick,
        },
        { default: () => slots.default?.() },
      );
  },
});

const componentCatalog: Record<string, Component> = {
  Alert,
  Button: A2UIButton,
  Card,
  Column: A2UIColumn,
  Divider: A2UIDivider,
  Progress,
  Row: A2UIRow,
  Statistic,
  Tag,
  Text: A2UIText,
  TextField: A2UITextField,
};

const rendererCommands = computed<XCardCommand[]>(() => {
  const normalizedCommands = props.commands.map((command) => {
    if (!("updateComponents" in command)) return command;

    return {
      ...command,
      updateComponents: {
        ...command.updateComponents,
        components: command.updateComponents.components.map((component) => {
          const normalized = { ...component };

          if (component.component === "Card") {
            normalized.size ??= "small";
            normalized.variant ??= "outlined";
          }
          if (component.component === "Alert") normalized.showIcon ??= true;
          if (component.component === "Button" || component.component === "TextField") {
            normalized.__a2uiSurfaceId = command.updateComponents.surfaceId;
          }
          if (
            component.component === "TextField" &&
            component.value &&
            typeof component.value === "object" &&
            "path" in component.value &&
            typeof component.value.path === "string"
          ) {
            normalized.__a2uiValuePath = `${A2UI_INTERNAL_PATH_PREFIX}${component.value.path}`;
          }

          return normalized;
        }),
      },
    };
  });
  const localDataUpdates: XCardCommand[] = Object.entries(inputValues).flatMap(
    ([surfaceId, surfaceValues]) =>
      Object.entries(surfaceValues).map(([path, value]) => ({
        version: "v0.9" as const,
        updateDataModel: { surfaceId, path, value },
      })),
  );

  return [...normalizedCommands, ...localDataUpdates];
});

const pathValue = {
  type: "object",
  properties: { path: { type: "string" } },
  required: ["path"],
};
const textValue = { anyOf: [{ type: "string" }, { type: "number" }, pathValue] };
const catalog: Catalog = {
  $id: "local://open-chat/basic",
  catalogId: "local://open-chat/basic",
  title: "Open Chat A2UI catalog",
  components: {
    Alert: {
      type: "object",
      properties: {
        message: textValue,
        description: textValue,
        type: { enum: ["success", "info", "warning", "error"] },
        showIcon: { type: "boolean" },
      },
    },
    Button: {
      type: "object",
      properties: {
        variant: { enum: ["default", "primary", "text", "link"] },
        danger: { type: "boolean" },
        disabled: { type: "boolean" },
        loading: { type: "boolean" },
        action: { type: "object" },
      },
    },
    Card: {
      type: "object",
      properties: {
        title: textValue,
        size: { enum: ["small", "medium", "default"] },
        loading: { type: "boolean" },
        hoverable: { type: "boolean" },
      },
    },
    Column: {
      type: "object",
      properties: {
        align: { type: "string" },
        justify: { type: "string" },
        gap: { anyOf: [{ type: "number" }, { type: "string" }] },
      },
    },
    Divider: {
      type: "object",
      properties: { axis: { enum: ["horizontal", "vertical"] } },
    },
    Progress: {
      type: "object",
      properties: {
        percent: { anyOf: [{ type: "number" }, pathValue] },
        status: { enum: ["normal", "active", "success", "exception"] },
        showInfo: { type: "boolean" },
      },
    },
    Row: {
      type: "object",
      properties: {
        align: { type: "string" },
        justify: { type: "string" },
        gap: { anyOf: [{ type: "number" }, { type: "string" }] },
        wrap: { type: "boolean" },
      },
    },
    Statistic: {
      type: "object",
      properties: {
        title: textValue,
        value: textValue,
        prefix: textValue,
        suffix: textValue,
        precision: { type: "number" },
      },
    },
    Tag: {
      type: "object",
      properties: { color: { type: "string" }, bordered: { type: "boolean" } },
    },
    Text: {
      type: "object",
      properties: {
        text: textValue,
        variant: {
          enum: [
            "body",
            "caption",
            "secondary",
            "h1",
            "h2",
            "h3",
            "h4",
            "success",
            "warning",
            "danger",
          ],
        },
        strong: { type: "boolean" },
      },
    },
    TextField: {
      type: "object",
      properties: {
        label: { type: "string" },
        value: textValue,
        placeholder: { type: "string" },
        disabled: { type: "boolean" },
      },
    },
  },
};
registerCatalog(catalog);
</script>

<template>
  <div v-if="surfaceIds.length || pending || errors.length" class="a2ui-renderer">
    <XCardBox
      v-if="surfaceIds.length"
      :commands="rendererCommands"
      :components="componentCatalog"
      :on-action="(payload) => emit('action', payload)"
    >
      <XCardCard v-for="surfaceId in surfaceIds" :id="surfaceId" :key="surfaceId" />
    </XCardBox>

    <div v-if="pending" class="a2ui-pending" aria-label="界面生成中">
      <Skeleton active :paragraph="{ rows: 2 }" :title="false" />
    </div>
    <Alert
      v-for="error in errors"
      :key="error"
      class="a2ui-error"
      type="error"
      show-icon
      :message="error"
    />
  </div>
</template>

<style scoped>
.a2ui-renderer {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  margin-top: 4px;
}
.a2ui-renderer :deep(.ant-card) {
  width: min(100%, 560px);
}
.a2ui-renderer :deep(.ant-card-body) {
  min-width: 0;
}
.a2ui-layout,
.a2ui-field,
.a2ui-divider {
  width: 100%;
  min-width: 0;
}
.a2ui-title {
  margin: 0 !important;
  letter-spacing: 0;
}
.a2ui-copy {
  min-width: 0;
  overflow-wrap: anywhere;
}
.a2ui-field-label {
  line-height: 1.4;
}
.a2ui-pending,
.a2ui-error {
  width: min(100%, 560px);
}
.a2ui-pending {
  padding-block: 8px;
}
</style>
