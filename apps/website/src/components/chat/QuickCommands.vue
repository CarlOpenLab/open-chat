<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { filterQuickCommands, type QuickCommandMeta } from "../../utils/senderCommands";

interface Props {
  modelValue: string;
  visible?: boolean;
  isOhMyPi?: boolean;
}

interface Emits {
  (e: "select", command: QuickCommandMeta, remaining: string): void;
  (e: "close"): void;
}

const props = withDefaults(defineProps<Props>(), {
  visible: true,
  isOhMyPi: false,
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

const filtered = computed(() => filterQuickCommands(query.value, Boolean(props.isOhMyPi)));

const shouldShow = computed(() => {
  if (!props.visible) return false;
  const trimmed = props.modelValue.trimStart();
  if (!trimmed.startsWith("/")) return false;
  if (
    trimmed.includes(" ") &&
    filtered.value.length === 1 &&
    filtered.value[0].command.toLowerCase() === query.value.toLowerCase()
  ) {
    return false;
  }
  return filtered.value.length > 0;
});

const selectedIndex = ref(0);

watch(filtered, (list) => {
  if (selectedIndex.value >= list.length) selectedIndex.value = 0;
});

watch(
  () => props.modelValue,
  () => {
    selectedIndex.value = 0;
  },
);

const select = (command: QuickCommandMeta) => {
  emit("select", command, argPart.value);
};

defineExpose({
  get shouldShow() {
    return shouldShow.value;
  },
  move(delta: -1 | 1) {
    const len = filtered.value.length;
    if (!len) return false;
    selectedIndex.value = (selectedIndex.value + delta + len) % len;
    return true;
  },
  confirm() {
    const cmd = filtered.value[selectedIndex.value];
    if (!cmd) return false;
    emit("select", cmd, argPart.value);
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
    <div v-if="shouldShow" class="quick-commands-card" role="listbox" aria-label="快捷指令">
      <div class="quick-commands-list">
        <button
          v-for="(cmd, index) in filtered"
          :key="cmd.command"
          type="button"
          role="option"
          :aria-selected="index === selectedIndex"
          class="quick-commands-item"
          :class="{
            'is-selected': index === selectedIndex,
            'is-ohmy': cmd.ohMyPiPriority && isOhMyPi,
          }"
          @click="select(cmd)"
          @mouseenter="selectedIndex = index"
          @mousemove="selectedIndex = index"
        >
          <span class="quick-commands-icon">{{ cmd.icon }}</span>
          <span class="quick-commands-copy">
            <span class="quick-commands-label">
              /{{ cmd.command }}
              <span v-if="cmd.ohMyPiPriority && isOhMyPi" class="quick-commands-badge"
                >Oh My Pi</span
              >
            </span>
            <span class="quick-commands-desc">{{ cmd.description }}</span>
          </span>
          <span class="quick-commands-placeholder">{{ cmd.placeholder }}</span>
        </button>
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
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.quick-commands-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
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
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--brand-inset);
  border: 1px solid var(--brand-border);
  font-size: 13px;
}

.quick-commands-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.quick-commands-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-foreground);
}

.quick-commands-badge {
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--brand-accent);
  color: white;
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
}

.quick-commands-desc {
  font-size: 11px;
  color: var(--brand-muted);
  line-height: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-commands-placeholder {
  flex: none;
  max-width: 160px;
  font-size: 10px;
  color: var(--brand-ghost);
  text-align: right;
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
