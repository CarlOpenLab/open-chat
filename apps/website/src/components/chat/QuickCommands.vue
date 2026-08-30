<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import type { SkillsIndex } from "../../services/ai";
import { filterSuggestionGroups, type SenderSuggestion } from "../../utils/senderCommands";

interface Props {
  modelValue: string;
  visible?: boolean;
  isOhMyPi?: boolean;
  /** 项目 / 全局 skills（Agent 会话才由 ChatInput 拉取）；空列表时对应分组隐藏。 */
  skills?: SkillsIndex | null;
}

interface Emits {
  (e: "select", item: SenderSuggestion, remaining: string): void;
  (e: "close"): void;
}

const props = withDefaults(defineProps<Props>(), {
  visible: true,
  isOhMyPi: false,
  skills: null,
});

const emit = defineEmits<Emits>();

const query = computed(() => {
  const v = props.modelValue.trimStart();
  if (!v.startsWith("/")) return "";
  const afterSlash = v.slice(1);
  const spaceIndex = afterSlash.search(/\s/);
  if (spaceIndex === -1) return afterSlash;
  return afterSlash.slice(0, spaceIndex);
});

const argPart = computed(() => {
  const v = props.modelValue.trimStart();
  if (!v.startsWith("/")) return "";
  const afterSlash = v.slice(1);
  const spaceIndex = afterSlash.search(/\s/);
  if (spaceIndex === -1) return "";
  return afterSlash.slice(spaceIndex + 1);
});

const groups = computed(() =>
  filterSuggestionGroups(query.value, props.skills, Boolean(props.isOhMyPi)),
);

/** 键盘导航把分组摊平成一个列表。 */
const flatItems = computed(() => groups.value.flatMap((group) => group.items));

const shouldShow = computed(() => {
  if (!props.visible) return false;
  const trimmed = props.modelValue.trimStart();
  if (!trimmed.startsWith("/")) return false;
  const flat = flatItems.value;
  if (
    trimmed.includes(" ") &&
    flat.length === 1 &&
    flat[0].name.toLowerCase() === query.value.toLowerCase()
  ) {
    return false;
  }
  return flat.length > 0;
});

const selectedIndex = ref(0);

watch(flatItems, (list) => {
  if (selectedIndex.value >= list.length) selectedIndex.value = 0;
});

watch(
  () => props.modelValue,
  () => {
    selectedIndex.value = 0;
  },
);

const itemKey = (item: SenderSuggestion): string =>
  item.kind === "command" ? `cmd-${item.command}` : `skill-${item.source}-${item.name}`;

const select = (item: SenderSuggestion) => {
  emit("select", item, argPart.value);
};

defineExpose({
  get shouldShow() {
    return shouldShow.value;
  },
  move(delta: -1 | 1) {
    const len = flatItems.value.length;
    if (!len) return false;
    selectedIndex.value = (selectedIndex.value + delta + len) % len;
    return true;
  },
  confirm() {
    const item = flatItems.value[selectedIndex.value];
    if (!item) return false;
    select(item);
    return true;
  },
});

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape" && shouldShow.value) {
    emit("close");
  }
};

watch(shouldShow, (show) => {
  if (show) window.addEventListener("keydown", handleGlobalKeydown);
  else window.removeEventListener("keydown", handleGlobalKeydown);
});

onBeforeUnmount(() => window.removeEventListener("keydown", handleGlobalKeydown));
</script>

<template>
  <Transition name="quick-commands">
    <div v-if="shouldShow" class="quick-commands-card" role="listbox" aria-label="斜杠建议">
      <div class="quick-commands-list">
        <template v-for="group in groups" :key="group.key">
          <div class="quick-commands-group" role="presentation">{{ group.title }}</div>
          <button
            v-for="item in group.items"
            :key="itemKey(item)"
            type="button"
            role="option"
            :aria-selected="flatItems[selectedIndex] === item"
            class="quick-commands-item"
            :class="{
              'is-selected': flatItems[selectedIndex] === item,
              'is-ohmy': item.kind === 'command' && item.ohMyPiPriority && isOhMyPi,
            }"
            :title="item.kind === 'command' ? item.placeholder : item.scope"
            @click="select(item)"
            @mouseenter="selectedIndex = flatItems.indexOf(item)"
            @mousemove="selectedIndex = flatItems.indexOf(item)"
          >
            <span class="quick-commands-icon">{{
              item.kind === "command" ? item.icon : "🧩"
            }}</span>
            <span class="quick-commands-label">
              /{{ item.name }}
              <span
                v-if="item.kind === 'skill'"
                class="quick-commands-scope"
                :class="`is-${item.source}`"
                >{{ item.source === "project" ? "项目" : "全局" }}</span
              >
              <span
                v-if="item.kind === 'command' && item.ohMyPiPriority && isOhMyPi"
                class="quick-commands-badge"
                >Oh My Pi</span
              >
            </span>
            <span class="quick-commands-desc">{{ item.description }}</span>
          </button>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.quick-commands-card {
  width: 100%;
}

.quick-commands-list {
  overflow-y: auto;
  max-height: 320px;
  padding: 3px;
  display: flex;
  flex-direction: column;
}

.quick-commands-group {
  padding: 5px 9px 2px;
  color: var(--brand-ghost);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  user-select: none;
}

.quick-commands-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 3px 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition:
    background 140ms ease,
    border-color 140ms ease;
}

.quick-commands-item:hover,
.quick-commands-item.is-selected {
  border-color: var(--brand-border-strong);
  background: var(--brand-surface-subtle);
}

.quick-commands-item.is-selected {
  background: var(--brand-surface-subtle);
  border-color: var(--brand-accent);
}

.quick-commands-item.is-ohmy.is-selected {
  background: linear-gradient(to right, rgba(99, 102, 241, 0.08), var(--brand-surface-subtle));
}

.quick-commands-icon {
  flex: none;
  width: 16px;
  text-align: center;
  font-size: 11px;
  line-height: 16px;
}

.quick-commands-label {
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-foreground);
}

.quick-commands-scope {
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 600;
  line-height: 13px;
}

.quick-commands-scope.is-project {
  background: color-mix(in srgb, var(--brand-accent) 14%, transparent);
  color: var(--brand-accent);
}

.quick-commands-scope.is-global {
  background: var(--brand-inset);
  color: var(--brand-muted-strong);
}

.quick-commands-badge {
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--brand-accent);
  color: white;
  font-size: 9px;
  font-weight: 600;
  line-height: 13px;
}

.quick-commands-desc {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--brand-muted);
  line-height: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-commands-enter-active,
.quick-commands-leave-active {
  max-height: 420px;
  overflow: hidden;
  transition:
    max-height 180ms ease,
    margin-bottom 180ms ease,
    opacity 180ms ease,
    transform 180ms ease;
  transform-origin: bottom center;
}

.quick-commands-enter-from,
.quick-commands-leave-to {
  max-height: 0;
  margin-bottom: 0;
  border-color: transparent;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
  transform: translateY(10px) scale(0.985);
}
</style>
