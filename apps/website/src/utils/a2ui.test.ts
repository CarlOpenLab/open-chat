import { expect, test } from "vite-plus/test";
import {
  collectA2UIConversationState,
  createA2UIDataModelSnapshot,
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

test("separates a complete A2UI block from surrounding Markdown", () => {
  const parsed = parseA2UIContent(`Before\n\n<a2ui-json>\n${commands}\n</a2ui-json>\n\nAfter`);

  expect(parsed.markdown).toBe("Before\n\n\n\nAfter");
  expect(parsed.commands).toHaveLength(2);
  expect(parsed.errors).toEqual([]);
  expect(parsed.hasPendingBlock).toBe(false);
});

test("hides an incomplete A2UI block while streaming", () => {
  const parsed = parseA2UIContent(`Visible\n\n<a2ui-json>\n${commands.slice(0, 80)}`);

  expect(parsed.markdown).toBe("Visible");
  expect(parsed.commands).toEqual([]);
  expect(parsed.hasPendingBlock).toBe(true);
});

test("extracts the json-a2ui fenced carrier before Markdown rendering", () => {
  const parsed = parseA2UIContent(`Before\n\n\`\`\`json-a2ui\n${commands}\n\`\`\`\n\nAfter`);

  expect(parsed.markdown).toBe("Before\n\n\nAfter");
  expect(parsed.commands).toHaveLength(2);
  expect(parsed.errors).toEqual([]);
  expect(parsed.hasPendingBlock).toBe(false);
});

test("does not parse an A2UI example inside a fenced code block", () => {
  const content = `\`\`\`text
<a2ui-json>
${commands}
</a2ui-json>
\`\`\``;
  const parsed = parseA2UIContent(content);

  expect(parsed.markdown).toBe(content);
  expect(parsed.commands).toEqual([]);
});

test("rejects malformed and unsupported commands", () => {
  const parsed = parseA2UIContent(`<a2ui-json>
[{"version":"v0.8","createSurface":{"surfaceId":"bad"}}]
</a2ui-json>`);

  expect(parsed.commands).toEqual([]);
  expect(parsed.errors).toHaveLength(1);
});

test("rejects nested children objects unsupported by the registered renderer", () => {
  const parsed = parseA2UIContent(`<a2ui-json>
[{"version":"v0.9","updateComponents":{"surfaceId":"card","components":[{"id":"root","component":"Column","children":[{"id":"nested"}]}]}}]
</a2ui-json>`);

  expect(parsed.commands).toEqual([]);
  expect(parsed.errors).toHaveLength(1);
});

test("rejects root data model replacement unsupported by x-card", () => {
  const parsed = parseA2UIContent(`<a2ui-json>
[{"version":"v0.9","updateDataModel":{"surfaceId":"card","path":"/","value":{}}}]
</a2ui-json>`);

  expect(parsed.commands).toEqual([]);
  expect(parsed.errors).toHaveLength(1);
});

test("collects one active surface across assistant messages", () => {
  const state = collectA2UIConversationState([
    {
      role: "assistant",
      status: "success",
      content: `<a2ui-json>${commands}</a2ui-json>`,
    },
    {
      role: "assistant",
      status: "success",
      content: `<a2ui-json>[{"version":"v0.9","updateDataModel":{"surfaceId":"status-card","path":"/status","value":"Updated"}}]</a2ui-json>`,
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
      content: '<a2ui-json>[{"version":"v0.9"',
    },
  ]);

  expect(state.commands).toEqual([]);
  expect(state.pending).toBe(true);
});
