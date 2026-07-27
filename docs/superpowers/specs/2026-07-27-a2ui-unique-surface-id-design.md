# A2UI Unique Surface ID Design

## Problem

Submitting an A2UI form locks and preserves the rendered form, but it does not delete its Surface. The ticket branch system prompt currently requires every form to use the fixed ID `ticket-branch-form`. When the user asks for another form in the same conversation, the model recreates that still-active ID and the host correctly rejects it as a duplicate.

Changing only the ticket branch prompt would not fix existing conversations because their generated system prompts are persisted in local chat state.

## Behavior

- Every new A2UI Surface must use an ID that has not appeared in an earlier `createSurface` command in the conversation.
- Ticket branch form IDs use the stable semantic prefix `ticket-branch-form` and an incrementing numeric suffix, starting at `ticket-branch-form-1`.
- A later form uses the next available suffix, such as `ticket-branch-form-2`.
- Every command belonging to one Surface uses the same ID, including `createSurface`, `updateComponents`, `updateDataModel`, and action context metadata.
- Existing duplicate detection remains unchanged. Reusing an active Surface ID is still a protocol error.
- Submitted forms remain visible and locked. A new form is a separate blank Surface rather than an update to the submitted one.

## Request Context

Before each model request, the client scans prior assistant messages for valid A2UI `createSurface` commands and collects their Surface IDs. When at least one ID exists, it appends transient system instructions that:

1. List the Surface IDs already used in the current conversation.
2. Prohibit those IDs in future `createSurface` commands.
3. Require a new semantic ID with the next available numeric suffix.
4. Require all commands in the new A2UI block to use that new ID consistently.

This context is generated at request time and is not persisted as part of the conversation's base system prompt. It therefore fixes both newly created and previously persisted ticket branch conversations.

The client only extracts IDs from valid, complete A2UI blocks. Malformed or still-streaming blocks do not reserve an ID.

## Prompt Update

The ticket branch prompt's initial example changes from `ticket-branch-form` to `ticket-branch-form-1`. Its collection-stage rules distinguish the first form from a user-requested replacement and instruct the model to choose the next unused suffix for later forms. The general A2UI rules also state that `createSurface` IDs cannot be reused within a conversation.

## Testing

- Verify Surface ID collection across assistant messages, while ignoring user text, malformed blocks, and non-creation commands.
- Verify runtime instructions list used IDs and require a new consistent ID.
- Verify no runtime instructions are added when the conversation has no created Surface.
- Verify the ticket branch prompt starts at `ticket-branch-form-1` and documents the incrementing rule.
- Keep existing duplicate-Surface tests and run the complete website test, type, lint, and formatting checks.
