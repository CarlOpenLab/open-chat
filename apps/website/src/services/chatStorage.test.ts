import { expect, test } from "vite-plus/test";
import { normalizePersistedChatState } from "./chatStorage";

test("migrates v1 chat state with an empty A2UI submission list", () => {
  expect(
    normalizePersistedChatState({
      version: 1,
      currentConversationKey: 42,
      currentModel: "test-model",
      conversationList: [
        {
          key: "42",
          label: "Legacy chat",
          messages: [],
        },
      ],
    }),
  ).toEqual({
    version: 2,
    currentConversationKey: "42",
    currentModel: "test-model",
    conversationList: [
      {
        key: "42",
        label: "Legacy chat",
        messages: [],
        a2uiSubmissions: [],
      },
    ],
  });
});

test("preserves structured A2UI submissions in v2 chat state", () => {
  const submission = {
    submissionId: "sub-1",
    conversationId: "conversation-1",
    ownerMessageId: "assistant-1",
    surfaceId: "brief-form",
    surfaceRevision: 3,
    action: { name: "submit", context: { source: "brief" } },
    data: { form: { name: "Carl" } },
    status: "submitted",
    submittedAt: 1721730000000,
  };

  expect(
    normalizePersistedChatState({
      version: 2,
      currentConversationKey: "conversation-1",
      currentModel: "test-model",
      conversationList: [
        {
          key: "conversation-1",
          label: "A2UI chat",
          messages: [],
          a2uiSubmissions: [submission, { submissionId: "broken" }],
        },
      ],
    })?.conversationList[0]?.a2uiSubmissions,
  ).toEqual([submission]);
});
