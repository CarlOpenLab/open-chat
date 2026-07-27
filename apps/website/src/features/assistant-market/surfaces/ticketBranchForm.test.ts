import { expect, test } from "vite-plus/test";
import { parseA2UIContent } from "../../../utils/a2ui";
import { TICKET_BRANCH_INITIAL_ASSISTANT_MESSAGE } from "./ticketBranchForm";

test("provides a valid fixed opening form for the ticket branch assistant", () => {
  const parsed = parseA2UIContent(TICKET_BRANCH_INITIAL_ASSISTANT_MESSAGE);

  expect(parsed.errors).toEqual([]);
  expect(parsed.hasPendingBlock).toBe(false);
  expect(parsed.commands).toHaveLength(4);
  expect(TICKET_BRANCH_INITIAL_ASSISTANT_MESSAGE).toContain('"label":"工单 ID 或链接 *"');
  expect(TICKET_BRANCH_INITIAL_ASSISTANT_MESSAGE).toContain('"label":"需求标题 *"');
});
