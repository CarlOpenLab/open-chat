import { computed, onMounted, ref } from "vue";
import { loadAssistantInstallations, saveAssistantInstallations } from "./assistantStorage";

export function useAssistantInstallations() {
  const installedAssistantIds = ref<string[]>([]);
  const hydrating = ref(true);
  let hydrationPromise: Promise<void> | null = null;

  const installedIdSet = computed(() => new Set(installedAssistantIds.value));
  const isInstalled = (assistantId: string) => installedIdSet.value.has(assistantId);

  const hydrate = () => {
    if (!hydrationPromise) {
      hydrationPromise = loadAssistantInstallations().then((installedIds) => {
        installedAssistantIds.value = installedIds;
        hydrating.value = false;
      });
    }
    return hydrationPromise;
  };

  const persist = async () => {
    await saveAssistantInstallations(installedAssistantIds.value);
  };

  const install = async (assistantId: string) => {
    await hydrate();
    if (!isInstalled(assistantId)) {
      installedAssistantIds.value = [...installedAssistantIds.value, assistantId];
      await persist();
    }
  };

  const uninstall = async (assistantId: string) => {
    await hydrate();
    installedAssistantIds.value = installedAssistantIds.value.filter((id) => id !== assistantId);
    await persist();
  };

  onMounted(() => {
    void hydrate();
  });

  return { installedAssistantIds, hydrating, isInstalled, install, uninstall };
}
