# Open Chat landing demo high-fidelity redesign

## Goal

Rebuild the landing-page Chat demo as a high-fidelity, compact representation of the current `/chat` workspace while removing the non-functional sharing feature from the entire application.

The result should feel like the actual product embedded in the landing page, not a browser mockup decorated to resemble it.

## Scope

- Redesign `LandingChatDemo`, `LandingDemoSidebar`, and `LandingDemoMessage` against the current Chat workspace.
- Preserve the landing demo's local interactions: conversation selection, new conversation, starter prompts, model selection, message submission, streaming response, and stop generation.
- Remove sharing UI and behavior from both the landing demo and `/chat`.
- Remove the unused sharing modal implementation after all references are deleted.
- Preserve the existing Zinc light/dark theme and UnoCSS/Vue stack.

## Visual Direction

The real Chat workspace is the binding visual reference. The landing demo will use the same spacing rhythm, typography scale, surface tokens, icon sizing, message width, sidebar behavior, and composer proportions.

The design will use surface contrast and whitespace before borders. Visible lines are limited to boundaries that communicate structure:

1. One subtle outer boundary around the embedded product viewport.
2. One separator between the sidebar and workspace.
3. One clear boundary around the message composer.

The faux browser toolbar, address field, traffic-light controls, live badge, duplicate share action, header divider, framed task table, and bordered suggestion chips will be removed. Conversation selection, task rows, prompt actions, and account controls will use quiet tonal fills and hover states.

The UI Pro Max palette recommendation is intentionally not adopted because its purple/pink AI palette conflicts with the repository's established monochrome Zinc brand system. Its applicable guidance is retained: avoid heavy chrome, keep semantic controls, preserve focus states, use restrained 150-300 ms feedback, and verify responsive behavior.

## Component Design

### Landing product viewport

`LandingChatDemo` remains a self-contained interactive demo with local state. Its root becomes the product viewport directly, without a simulated browser frame. Desktop dimensions remain stable and responsive so the hero does not shift during interaction.

The workspace header mirrors the real Chat title treatment and sync status but contains no sharing control. It retains the sidebar reveal control when the sidebar is hidden.

### Sidebar

`LandingDemoSidebar` mirrors the current Chat sidebar hierarchy: brand, primary new-chat action, search, grouped conversations, upgrade row, and account row. The demo uses simpler local markup instead of importing the production `Conversations` state machinery.

Active and hover states rely on background fills. The sidebar has one structural separator at its right edge. Internal footer and item borders are removed unless required for a focus indicator.

### Messages and structured response

Messages use the production content width, avatar geometry, user bubble proportions, and assistant typography. The sample release checklist remains because it demonstrates useful rich output, but it changes from a bordered table to grouped tonal rows with spacing-based hierarchy.

### Composer

The composer follows `ChatInput` dimensions and control placement. It remains the strongest framed control in the demo because its boundary communicates input affordance. Starter prompts and follow-up suggestions become low-chrome actions using fills rather than outlined cards or chips.

## Sharing Removal

The following are removed as one feature deletion:

- Share button and `share` emit contract in `ChatHeader`.
- `shareOpen` state, keyboard cleanup, event binding, modal import, and modal mount in `Chat`.
- Both share buttons and related icon imports in the landing demo.
- `ShareConversationModal.vue` after confirming there are no remaining references.

No hidden or disabled sharing affordance remains.

## Responsive Behavior

- Desktop: sidebar and workspace remain visible inside a fixed, responsive product viewport.
- Tablet/mobile: sidebar starts closed and opens as an overlay drawer; the workspace keeps a stable single-column layout.
- Touch targets are at least 44 px on mobile.
- Long conversation names, model names, and task descriptions truncate without resizing controls.
- The demo must not introduce horizontal page scrolling at 375, 768, 1024, or 1440 px widths.

## Accessibility and Motion

- Use semantic `button`, `header`, `nav`, `main`/`section`, and `aside` elements.
- Keep visible keyboard focus indicators and accurate `aria-label`, `aria-expanded`, and live-region behavior.
- Preserve reduced-motion handling for stream and reveal effects.
- Decorative icons remain hidden from assistive technology where appropriate; icon-only commands retain labels and tooltips.

## Verification

- Add or update focused tests only where the repository already supports the behavior under change; UI appearance is verified through browser screenshots and interaction checks.
- Run `vp check` and `vp test`.
- Run the website production build.
- Search the repository to confirm no sharing UI, state, modal import, or share route string remains.
- Verify landing and `/chat` in light and dark themes at desktop and mobile viewport sizes.
- Exercise new conversation, sidebar open/close, conversation selection, model selection, prompt submission, streaming, and stop generation in the landing demo.

## Out of Scope

- Changing the real Chat information architecture beyond deleting sharing.
- Replacing the existing theme, typography, icon library, or component framework.
- Connecting the landing demo to live model APIs or persisted conversations.
- Redesigning unrelated landing-page sections.
