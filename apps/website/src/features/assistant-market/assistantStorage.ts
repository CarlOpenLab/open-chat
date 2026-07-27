import { readLocalValue, writeLocalValue } from "../../services/localDatabase";
import type { AssistantDefinition } from "./types";

const ASSISTANT_INSTALLATIONS_KEY = "assistant-installations-v1";
const CUSTOM_ASSISTANTS_KEY = "assistant-custom-definitions-v1";

interface PersistedAssistantInstallations {
  version: 1;
  installedAssistantIds: string[];
}

const normalizeInstallations = (value: unknown): string[] => {
  if (!value || typeof value !== "object") return [];
  const state = value as Partial<PersistedAssistantInstallations>;
  if (state.version !== 1 || !Array.isArray(state.installedAssistantIds)) return [];
  return [...new Set(state.installedAssistantIds.filter((id) => typeof id === "string" && id))];
};

export async function loadAssistantInstallations(): Promise<string[]> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return [];
  try {
    return normalizeInstallations(await readLocalValue<unknown>(ASSISTANT_INSTALLATIONS_KEY));
  } catch (error) {
    console.error("Failed to load assistant installations from IndexedDB:", error);
    return [];
  }
}

export async function saveAssistantInstallations(installedAssistantIds: string[]): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  try {
    await writeLocalValue<PersistedAssistantInstallations>(ASSISTANT_INSTALLATIONS_KEY, {
      version: 1,
      installedAssistantIds: [...new Set(installedAssistantIds)],
    });
  } catch (error) {
    console.error("Failed to save assistant installations to IndexedDB:", error);
  }
}

export async function loadCustomAssistants(): Promise<AssistantDefinition[]> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return [];
  try {
    const value = await readLocalValue<unknown>(CUSTOM_ASSISTANTS_KEY);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is AssistantDefinition => {
      if (!item || typeof item !== "object") return false;
      const assistant = item as Partial<AssistantDefinition>;
      return (
        assistant.source === "custom" &&
        typeof assistant.id === "string" &&
        typeof assistant.name === "string" &&
        typeof assistant.systemPrompt === "string" &&
        Array.isArray(assistant.capabilities) &&
        Array.isArray(assistant.starterPrompts)
      );
    });
  } catch (error) {
    console.error("Failed to load custom assistants from IndexedDB:", error);
    return [];
  }
}

export async function saveCustomAssistants(assistants: AssistantDefinition[]): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  try {
    await writeLocalValue(CUSTOM_ASSISTANTS_KEY, assistants);
  } catch (error) {
    console.error("Failed to save custom assistants to IndexedDB:", error);
  }
}
