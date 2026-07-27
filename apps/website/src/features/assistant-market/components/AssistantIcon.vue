<script setup lang="ts">
import { Braces, ClipboardList, GitBranch, Microscope, PenLine, Shapes } from "@lucide/vue";
import { computed } from "vue";
import type { AssistantIconName } from "../types";

interface Props {
  name: AssistantIconName;
}

const props = defineProps<Props>();
const icons = {
  branch: GitBranch,
  code: Braces,
  edit: PenLine,
  meeting: ClipboardList,
  product: Shapes,
  research: Microscope,
};
const icon = computed(() => icons[props.name]);
</script>

<template>
  <component :is="icon" aria-hidden="true" />
</template>
