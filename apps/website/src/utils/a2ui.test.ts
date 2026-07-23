import { expect, test } from "vite-plus/test";
import {
  collectA2UIConversationState,
  createA2UIDataModelSnapshot,
  createA2UISubmission,
  flattenA2UIDataModelSnapshot,
  formatA2UISubmissionAsUserMessage,
  parseA2UIContent,
} from "./a2ui";

const commands = `[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "status-card",
      "catalogId": "local://open-chat/basic"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "status-card",
      "components": [{ "id": "root", "component": "Text", "text": "Ready" }]
    }
  }
]`;

test("builds a nested action context from bound form paths", () => {
  expect(
    createA2UIDataModelSnapshot({
      "/form/name": "Carl",
      "/form/contact/email": "carl@example.com",
      "/accepted": true,
    }),
  ).toEqual({
    form: { name: "Carl", contact: { email: "carl@example.com" } },
    accepted: true,
  });
});

test("ignores invalid and prototype-polluting form paths", () => {
  expect(
    createA2UIDataModelSnapshot({
      name: "missing-leading-slash",
      "/__proto__/polluted": true,
      "/form/constructor/value": "blocked",
      "/valid": "kept",
    }),
  ).toEqual({ valid: "kept" });
});

test("round-trips a submitted data model back to bound paths", () => {
  const snapshot = {
    form: {
      name: "Carl",
      contact: { email: "carl@example.com" },
      "source/path": "docs",
    },
    accepted: true,
  };

  const valuesByPath = flattenA2UIDataModelSnapshot(snapshot);
  expect(valuesByPath).toEqual({
    "/form/name": "Carl",
    "/form/contact/email": "carl@example.com",
    "/form/source~1path": "docs",
    "/accepted": true,
  });
  expect(createA2UIDataModelSnapshot(valuesByPath)).toEqual(snapshot);
});

test("formats a submission as a readable user message", () => {
  const submission = createA2UISubmission(
    {
      surfaceId: "brief-form",
      surfaceRevision: 4,
      ownerMessageId: "assistant-1",
      name: "submitBrief",
      context: { source: "brief" },
      data: { form: { name: "Carl", email: "carl@example.com" } },
    },
    "conversation-1",
    1721730000000,
  );

  const formatted = formatA2UISubmissionAsUserMessage(submission);
  expect(formatted).toBe(
    `[表单提交] submitBrief\n\n${JSON.stringify({ form: { name: "Carl", email: "carl@example.com" } }, null, 2)}`,
  );
});

test("separates a complete A2UI block from surrounding Markdown", () => {
  const parsed = parseA2UIContent(`Before\n\n<a2ui>\n${commands}\n</a2ui>\n\nAfter`);

  expect(parsed.markdown).toBe("Before\n\n\n\nAfter");
  expect(parsed.commands).toHaveLength(2);
  expect(parsed.errors).toEqual([]);
  expect(parsed.hasPendingBlock).toBe(false);
});

test("hides an incomplete A2UI block while streaming", () => {
  const parsed = parseA2UIContent(`Visible\n\n<a2ui>\n${commands.slice(0, 80)}`);

  expect(parsed.markdown).toBe("Visible");
  expect(parsed.commands).toEqual([]);
  expect(parsed.hasPendingBlock).toBe(true);
});

test("does not parse an A2UI example inside a fenced code block", () => {
  const content = `\`\`\`text
<a2ui>
${commands}
</a2ui>
\`\`\``;
  const parsed = parseA2UIContent(content);

  expect(parsed.markdown).toBe(content);
  expect(parsed.commands).toEqual([]);
});

test("rejects malformed and unsupported commands", () => {
  const parsed = parseA2UIContent(`<a2ui>
[{"version":"v0.8","createSurface":{"surfaceId":"bad"}}]
</a2ui>`);

  expect(parsed.commands).toEqual([]);
  expect(parsed.errors).toHaveLength(1);
});

test("rejects nested children objects unsupported by the registered renderer", () => {
  const parsed = parseA2UIContent(`<a2ui>
[{"version":"v0.9","updateComponents":{"surfaceId":"card","components":[{"id":"root","component":"Column","children":[{"id":"nested"}]}]}}]
</a2ui>`);

  expect(parsed.commands).toEqual([]);
  expect(parsed.errors).toHaveLength(1);
});

test("rejects root data model replacement unsupported by x-card", () => {
  const parsed = parseA2UIContent(`<a2ui>
[{"version":"v0.9","updateDataModel":{"surfaceId":"card","path":"/","value":{}}}]
</a2ui>`);

  expect(parsed.commands).toEqual([]);
  expect(parsed.errors).toHaveLength(1);
});

test("collects one active surface across assistant messages", () => {
  const state = collectA2UIConversationState([
    {
      role: "assistant",
      status: "success",
      content: `<a2ui>${commands}</a2ui>`,
    },
    {
      role: "assistant",
      status: "success",
      content: `<a2ui>[{"version":"v0.9","updateDataModel":{"surfaceId":"status-card","path":"/status","value":"Updated"}}]</a2ui>`,
    },
  ]);

  expect(state.commands).toHaveLength(3);
  expect(state.errors).toEqual([]);
  expect(state.pending).toBe(false);
});

test("reports a pending surface block only while its message is loading", () => {
  const state = collectA2UIConversationState([
    {
      role: "assistant",
      status: "loading",
      content: '<a2ui>[{"version":"v0.9"',
    },
  ]);

  expect(state.commands).toEqual([]);
  expect(state.pending).toBe(true);
});
