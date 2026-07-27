export type AssistantCategory = "开发" | "产品" | "写作" | "研究" | "效率";
export type AssistantCapability = "a2ui" | "files" | "web-search";
export type AssistantIconName = "branch" | "code" | "edit" | "meeting" | "product" | "research";

export interface AssistantStarterPrompt {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

export interface AssistantDefinition {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: AssistantCategory;
  tags: string[];
  author: string;
  icon: AssistantIconName;
  versionId: string;
  version: string;
  updatedAt: string;
  capabilities: AssistantCapability[];
  starterPrompts: AssistantStarterPrompt[];
  systemPrompt: string | (() => string);
  initialAssistantMessage?: string;
  featured?: boolean;
  rating: number;
  installCount: number;
  source?: "official" | "custom";
  forkedFromAssistantId?: string;
}

export interface AssistantConversationSnapshot {
  assistantId: string;
  slug: string;
  name: string;
  icon: AssistantIconName;
  versionId: string;
  version: string;
  capabilities: AssistantCapability[];
  starterPrompts: AssistantStarterPrompt[];
  renderedSystemPrompt: string;
  initialAssistantMessage?: string;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const ASSISTANT_ICON_NAMES: AssistantIconName[] = [
  "branch",
  "code",
  "edit",
  "meeting",
  "product",
  "research",
];
const ASSISTANT_CAPABILITIES: AssistantCapability[] = ["a2ui", "files", "web-search"];

const isStarterPrompt = (value: unknown): value is AssistantStarterPrompt => {
  if (!value || typeof value !== "object") return false;
  const prompt = value as Partial<AssistantStarterPrompt>;
  return (
    typeof prompt.id === "string" &&
    typeof prompt.label === "string" &&
    typeof prompt.description === "string" &&
    typeof prompt.prompt === "string"
  );
};

export function isAssistantConversationSnapshot(
  value: unknown,
): value is AssistantConversationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<AssistantConversationSnapshot>;
  return (
    typeof snapshot.assistantId === "string" &&
    typeof snapshot.slug === "string" &&
    typeof snapshot.name === "string" &&
    typeof snapshot.icon === "string" &&
    ASSISTANT_ICON_NAMES.includes(snapshot.icon as AssistantIconName) &&
    typeof snapshot.versionId === "string" &&
    typeof snapshot.version === "string" &&
    isStringArray(snapshot.capabilities) &&
    snapshot.capabilities.every((capability) =>
      ASSISTANT_CAPABILITIES.includes(capability as AssistantCapability),
    ) &&
    Array.isArray(snapshot.starterPrompts) &&
    snapshot.starterPrompts.every(isStarterPrompt) &&
    typeof snapshot.renderedSystemPrompt === "string" &&
    (snapshot.initialAssistantMessage === undefined ||
      typeof snapshot.initialAssistantMessage === "string")
  );
}
