import { expect, test } from "vite-plus/test";
import { normalizeMarkdownContent } from "./normalizeMarkdown";

test("unwraps a JSON-encoded fenced code block", () => {
  const content =
    '"```python\\n# -*- coding: utf-8 -*-\\n\\ndef greet(name):\\n    return f\\"你好，{name}！\\"\\n\\nprint(greet(\\"Carl\\"))\\n```"';

  expect(normalizeMarkdownContent(content)).toBe(`\`\`\`python
# -*- coding: utf-8 -*-

def greet(name):
    return f"你好，{name}！"

print(greet("Carl"))
\`\`\``);
});

test("keeps regular quoted Markdown unchanged", () => {
  const content = '"Use `\\n` to represent a line break."';

  expect(normalizeMarkdownContent(content)).toBe(content);
});

test("keeps invalid JSON unchanged", () => {
  const content = '"```python\\nprint("hello")\\n```"';

  expect(normalizeMarkdownContent(content)).toBe(content);
});

test("keeps normal fenced code unchanged", () => {
  const content = "```python\nprint('hello')\n```";

  expect(normalizeMarkdownContent(content)).toBe(content);
});
