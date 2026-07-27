import { expect, test } from "vite-plus/test";
import {
  createAssistantConversationSnapshot,
  createCustomAssistantDefinition,
  getAssistantById,
} from "./catalog";

test("creates an editable private fork while preserving assistant behavior", () => {
  const official = getAssistantById("official-product-strategist");
  expect(official).toBeDefined();
  if (!official) return;

  const fork = createCustomAssistantDefinition({
    name: `${official.name} 副本`,
    tagline: official.tagline,
    description: official.description,
    category: official.category,
    systemPrompt: "自定义产品策略 prompt",
    capabilities: official.capabilities,
    starterPrompts: official.starterPrompts,
    icon: official.icon,
    tags: [...official.tags, "私人副本"],
    forkedFromAssistantId: official.id,
  });

  expect(fork.source).toBe("custom");
  expect(fork.forkedFromAssistantId).toBe(official.id);
  expect(fork.icon).toBe(official.icon);
  expect(fork.capabilities).toEqual(official.capabilities);
  expect(fork.starterPrompts).toEqual(official.starterPrompts);
  expect(createAssistantConversationSnapshot(fork).renderedSystemPrompt).toBe(
    "自定义产品策略 prompt",
  );
});

test("includes the fixed opening form in ticket branch snapshots", () => {
  const assistant = getAssistantById("official-ticket-branch");
  expect(assistant).toBeDefined();
  if (!assistant) return;

  const snapshot = createAssistantConversationSnapshot(assistant);
  expect(snapshot.initialAssistantMessage).toContain('"surfaceId":"ticket-branch-form-1"');
  expect(snapshot.renderedSystemPrompt).not.toContain("<a2ui>");
});
