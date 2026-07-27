import { expect, test } from "vite-plus/test";
import { A2UI_SYSTEM_PROMPT } from "./a2ui";

test("requires conversation-unique A2UI surface IDs", () => {
  expect(A2UI_SYSTEM_PROMPT).toContain(
    "Every createSurface surfaceId must be unique across the entire conversation",
  );
  expect(A2UI_SYSTEM_PROMPT).toContain("next unused positive integer suffix");
});
