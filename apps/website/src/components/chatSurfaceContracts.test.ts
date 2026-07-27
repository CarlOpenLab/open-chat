import { describe, expect, test } from "vite-plus/test";
import chat from "./Chat.vue?raw";
import header from "./chat/ChatHeader.vue?raw";
import landing from "./landing/LandingChatDemo.vue?raw";
import landingSidebar from "./landing/LandingDemoSidebar.vue?raw";

const chatComponentPaths = Object.keys(
  import.meta.glob("./chat/*.vue", { eager: true, import: "default", query: "?raw" }),
);

describe("Chat product surface contracts", () => {
  test("does not expose the removed sharing feature", () => {
    const combined = `${chat}\n${header}\n${landing}`;

    expect(combined).not.toMatch(/ShareConversationModal|shareOpen|@share|Share2|分享/);
    expect(chatComponentPaths).not.toContain("./chat/ShareConversationModal.vue");
  });

  test("keeps mobile sidebar commands at least 44px square", () => {
    expect(landingSidebar).toContain("lt-md:!h-[44px]");
    expect(landingSidebar).toContain("lt-md:!w-[44px]");
    expect(landingSidebar).toContain("lt-md:!min-w-[44px]");
  });

  test("uses the product workspace instead of faux browser chrome", () => {
    expect(landing).not.toMatch(/window-bar|window-address|window-controls|LockKeyhole|\bLive\b/);
    expect(landing).toContain('data-screen-label="Open Chat 产品预览"');
  });
});
