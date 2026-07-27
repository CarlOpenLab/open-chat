import { expect, test } from "vite-plus/test";
import { createTicketBranchSystemPrompt } from "./ticketBranch";

test("keeps the host-rendered form out of the model system prompt", () => {
  const prompt = createTicketBranchSystemPrompt(new Date(2025, 11, 4));

  expect(prompt).toContain("宿主应用已经直接向用户展示工单表单");
  expect(prompt).not.toContain("<a2ui>");
  expect(prompt).not.toContain("createSurface");
});

test("requires semantic English titles and extracts ticket IDs from URLs", () => {
  const prompt = createTicketBranchSystemPrompt(new Date(2026, 6, 27));

  expect(prompt).toContain("必须做英文语义翻译，禁止把中文逐字转成汉语拼音");
  expect(prompt).toContain("绝不能把完整 URL 放进分支名");
  expect(prompt).toContain(
    "git checkout -b feat/ai-report-assistant/20260727/6a5ed553d3f6adf4c9ba64e2",
  );
});
