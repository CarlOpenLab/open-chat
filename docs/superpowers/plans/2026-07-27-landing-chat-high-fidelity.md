# Landing Chat High-Fidelity Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the landing-page browser mockup with a high-fidelity preview of the real Chat workspace and remove the unused sharing feature everywhere.

**Architecture:** Keep the landing demo as an isolated local-state prototype so it never depends on live requests or persisted conversations. Align its presentation with the production Chat components through the existing brand tokens and measured component geometry, while using a focused source-contract test to prevent the removed share surface and faux browser chrome from returning.

**Tech Stack:** Vue 3 SFCs, TypeScript 5.9, UnoCSS, antdv-next, `@antdv-next/x`, Lucide Vue, Vite+, Vitest through `vite-plus/test`.

## Global Constraints

- The real `/chat` workspace is the binding visual reference.
- Keep only three kinds of visible structural boundaries: product viewport, sidebar/workspace separator, and composer boundary.
- Preserve the existing Zinc light/dark theme, typography, icon library, and component framework.
- Keep the landing demo local-only; do not connect it to model APIs or persisted conversations.
- Keep mobile touch targets at least 44 px and prevent horizontal page scrolling at 375, 768, 1024, and 1440 px widths.
- Remove sharing UI, state, events, modal code, and hard-coded share URLs rather than hiding them.

## File Structure

- Create `apps/website/src/components/chatSurfaceContracts.test.ts`: source-level product contract covering removed sharing and browser chrome.
- Modify `apps/website/src/components/Chat.vue`: remove share state, modal integration, and keyboard cleanup.
- Modify `apps/website/src/components/chat/ChatHeader.vue`: remove the share event and command.
- Delete `apps/website/src/components/chat/ShareConversationModal.vue`: remove the unused feature implementation.
- Modify `apps/website/src/components/landing/LandingChatDemo.vue`: make the Chat workspace itself the demo viewport and refine responsive interaction.
- Modify `apps/website/src/components/landing/LandingDemoSidebar.vue`: match production sidebar hierarchy with low-chrome surface states.
- Modify `apps/website/src/components/landing/LandingDemoMessage.vue`: match production message geometry and replace framed task-table styling.

---

### Task 1: Lock The Product Surface Contract

**Files:**

- Create: `apps/website/src/components/chatSurfaceContracts.test.ts`

**Interfaces:**

- Consumes: Vue SFC source files located relative to `import.meta.url`.
- Produces: regression tests asserting that sharing and faux browser chrome are absent from the user-facing Chat surfaces.

- [ ] **Step 1: Add the failing contract tests**

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

const readComponent = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("Chat product surface contracts", () => {
  test("does not expose the removed sharing feature", () => {
    const chat = readComponent("./Chat.vue");
    const header = readComponent("./chat/ChatHeader.vue");
    const landing = readComponent("./landing/LandingChatDemo.vue");
    const combined = `${chat}\n${header}\n${landing}`;

    expect(combined).not.toMatch(/ShareConversationModal|shareOpen|@share|Share2|分享/);
    expect(existsSync(new URL("./chat/ShareConversationModal.vue", import.meta.url))).toBe(false);
  });

  test("uses the product workspace instead of faux browser chrome", () => {
    const landing = readComponent("./landing/LandingChatDemo.vue");

    expect(landing).not.toMatch(/window-bar|window-address|window-controls|LockKeyhole|\bLive\b/);
    expect(landing).toContain('data-screen-label="Open Chat 产品预览"');
  });
});
```

- [ ] **Step 2: Run the focused test and verify both contracts fail**

Run: `vp test apps/website/src/components/chatSurfaceContracts.test.ts`

Expected: the sharing test fails on the existing share state/components and the chrome test fails on `window-bar`/`LockKeyhole` plus the missing screen label.

- [ ] **Step 3: Commit the failing contract test**

```bash
git add apps/website/src/components/chatSurfaceContracts.test.ts
git commit -m "test: lock chat product surface contract"
```

### Task 2: Remove Sharing From Production And Landing Chat

**Files:**

- Modify: `apps/website/src/components/Chat.vue`
- Modify: `apps/website/src/components/chat/ChatHeader.vue`
- Modify: `apps/website/src/components/landing/LandingChatDemo.vue`
- Delete: `apps/website/src/components/chat/ShareConversationModal.vue`
- Test: `apps/website/src/components/chatSurfaceContracts.test.ts`

**Interfaces:**

- Consumes: the existing `ChatHeader` props and non-sharing event contracts.
- Produces: a `ChatHeader` that emits `toggleSidebar`, `toggleWorkspace`, `export`, `rename`, `pin`, `archive`, and `delete`, with no share state or action.

- [ ] **Step 1: Remove the share command from `ChatHeader`**

Delete the `Share2` import, `(e: "share"): void` emit signature, and the button that calls `emit('share')`. Keep sync status and the conditional file-workspace control aligned at the right edge.

- [ ] **Step 2: Remove the share state and modal integration from `Chat`**

Delete the `ShareConversationModal` import, `shareOpen` ref, `shareOpen.value = false` keyboard cleanup, `@share="shareOpen = true"`, and `<ShareConversationModal v-model:open="shareOpen" />`.

- [ ] **Step 3: Remove both share affordances from the landing demo**

Delete the `Share2` import and both share buttons. This temporary edit only removes the feature; Task 3 replaces the full browser toolbar and header structure.

- [ ] **Step 4: Delete the unused modal implementation**

Delete `apps/website/src/components/chat/ShareConversationModal.vue` and verify no imports remain.

- [ ] **Step 5: Run the sharing contract and repository search**

Run: `vp test apps/website/src/components/chatSurfaceContracts.test.ts`

Expected: the sharing contract passes while the faux-browser contract still fails.

Run: `rg -n -i "ShareConversationModal|shareOpen|openchat\.dev/share|@share|Share2|分享" apps/website/src`

Expected: no output.

- [ ] **Step 6: Commit the feature removal**

```bash
git add apps/website/src/components/Chat.vue apps/website/src/components/chat/ChatHeader.vue apps/website/src/components/landing/LandingChatDemo.vue apps/website/src/components/chat/ShareConversationModal.vue
git commit -m "refactor(chat): remove unused sharing feature"
```

### Task 3: Rebuild The Landing Product Viewport

**Files:**

- Modify: `apps/website/src/components/landing/LandingChatDemo.vue`
- Test: `apps/website/src/components/chatSurfaceContracts.test.ts`

**Interfaces:**

- Consumes: `LandingDemoSidebar` events `select`, `newChat`, and `close`; `LandingDemoMessage` prop `message`; the existing `Sender` footer slot.
- Produces: a stable embedded workspace labeled `data-screen-label="Open Chat 产品预览"` with local conversation, model, prompt, stream, stop, and sidebar interactions.

- [ ] **Step 1: Replace the faux browser wrapper with the workspace viewport**

Use a root structure equivalent to:

```vue
<section
  data-screen-label="Open Chat 产品预览"
  class="demo-window relative mx-auto h-[min(680px,calc(100dvh-154px))] min-h-[570px] w-[min(1240px,100%)] overflow-hidden rounded-lg border border-solid border-brand-border bg-brand-workspace shadow-xl"
  aria-label="Open Chat 交互演示"
>
  <div class="demo-app grid h-full [transition:grid-template-columns_180ms_ease]">
    <!-- sidebar and workspace -->
  </div>
</section>
```

Remove the toolbar, address field, controls, lock icon, live indicator, and all CSS tied to `.window-bar`, `.window-address`, `.window-controls`, and `.window-actions`.

- [ ] **Step 2: Simplify the workspace header hierarchy**

Keep the title dropdown treatment and sync indicator from the production Chat header. Remove the bottom border and use the existing translucent workspace background plus spacing to separate the header from messages. Add `:aria-expanded="sidebarOpen"` to the sidebar reveal command.

- [ ] **Step 3: Align message and composer widths with production Chat**

Use a centered `780px` message/content maximum, production `13px/1.7` message typography, `26px` composer top fade, and the existing `ChatInput` sender geometry. Keep the product viewport height stable while messages stream.

- [ ] **Step 4: Convert starter and follow-up actions to low-chrome controls**

Replace borders on prompt cards and suggestion chips with `bg-brand-surface-subtle`/`hover:bg-brand-sidebar-hover` states. Keep three desktop columns for starter prompts, one mobile column, and 44px mobile targets.

- [ ] **Step 5: Correct responsive behavior**

Keep the sidebar as an overlay drawer below `760px`, initialize it closed on mobile, and retain the reveal command in the workspace header. Remove selectors that hide arbitrary spans through `:has`; hide the sync status with a dedicated class. Ensure the mobile viewport height is stable and the root has no horizontal overflow.

- [ ] **Step 6: Run the complete surface contract**

Run: `vp test apps/website/src/components/chatSurfaceContracts.test.ts`

Expected: both tests pass.

- [ ] **Step 7: Commit the viewport redesign**

```bash
git add apps/website/src/components/landing/LandingChatDemo.vue apps/website/src/components/chatSurfaceContracts.test.ts
git commit -m "feat(landing): rebuild chat demo as product viewport"
```

### Task 4: Refine Sidebar And Message Surfaces

**Files:**

- Modify: `apps/website/src/components/landing/LandingDemoSidebar.vue`
- Modify: `apps/website/src/components/landing/LandingDemoMessage.vue`

**Interfaces:**

- Consumes: unchanged sidebar props `conversations` and `activeKey`, unchanged emits `select`, `newChat`, and `close`, unchanged `DemoMessage` shape.
- Produces: high-fidelity production-style navigation and message rendering without internal decorative frames.

- [ ] **Step 1: Reduce sidebar chrome**

Keep only the sidebar's right structural separator. Remove the footer top border, avatar/upgrade tile borders, and transparent border declarations used only to normalize controls. Use tonal surfaces for active conversation, new-chat emphasis, account hover, and upgrade hover.

- [ ] **Step 2: Match production sidebar spacing and accessibility**

Keep the production hierarchy and dimensions: 42px brand row, 38px desktop actions, 34-40px conversation rows, and 44px mobile controls. Add `aria-current="page"` to the active conversation and `aria-expanded` to the close/reveal relationship where applicable.

- [ ] **Step 3: Replace the framed task list**

Remove the task-list outer border and row dividers. Render each task row on a quiet surface with a 6px radius and 4-6px vertical gap. Preserve risk labels, completion state, truncation, and the two-column mobile fallback.

- [ ] **Step 4: Match production message geometry**

Center assistant messages at `min(100%, 780px)`, retain the 30px assistant avatar and 12px gap, use the production user-bubble width and radius, and preserve the pending typing animation with reduced-motion support.

- [ ] **Step 5: Run static and type checks**

Run: `vp check`

Expected: formatting, linting, and TypeScript checks pass with no errors.

- [ ] **Step 6: Commit the visual refinement**

```bash
git add apps/website/src/components/landing/LandingDemoSidebar.vue apps/website/src/components/landing/LandingDemoMessage.vue
git commit -m "style(landing): reduce chat demo visual chrome"
```

### Task 5: Verify The High-Fidelity Result

**Files:**

- Modify only if verification exposes defects in files already listed above.

**Interfaces:**

- Consumes: completed landing demo and production Chat shell.
- Produces: verified light/dark desktop/mobile behavior and a clean build/test result.

- [ ] **Step 1: Run all automated verification**

```bash
vp check
vp test
vp run website#build
```

Expected: all three commands exit successfully.

- [ ] **Step 2: Start the website server**

Run from the repository root: `vp run website#dev -- --host 127.0.0.1 --port 3000`

Expected: Vite serves the app at `http://127.0.0.1:3000/`.

- [ ] **Step 3: Verify desktop landing interactions at 1440x1000**

Open the landing page, confirm only the viewport/sidebar/composer structural boundaries remain, then exercise conversation selection, new conversation, starter prompt, model menu, send, stop generation, sidebar close, and sidebar reopen.

- [ ] **Step 4: Verify responsive landing behavior**

Check 1024x900, 768x900, and 375x812. Confirm no horizontal page scroll, the sidebar starts closed at 375px, the drawer opens and closes without covering its reveal command after dismissal, controls do not overlap, and text truncates inside fixed controls.

- [ ] **Step 5: Verify production Chat and themes**

Open `/chat` in light and dark modes. Confirm the header has no sharing action, sync and workspace controls remain aligned, and no sharing modal can be opened. Repeat landing checks in dark mode.

- [ ] **Step 6: Capture screenshots and inspect console output**

Capture landing screenshots at 1440x1000 and 375x812 plus `/chat` at 1440x1000. Confirm the console has no runtime errors and inspect the images for unintended lines, overlap, blank content, clipping, and inconsistent framing.

- [ ] **Step 7: Run the final removal search**

Run: `rg -n -i "ShareConversationModal|shareOpen|openchat\.dev/share|@share|Share2|分享|window-bar|window-address|LockKeyhole" apps/website/src`

Expected: no output.

- [ ] **Step 8: Commit verification fixes if any were required**

```bash
git add apps/website/src/components
git commit -m "fix(landing): polish chat demo responsive details"
```
