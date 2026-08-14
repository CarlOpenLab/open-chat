# Prompt organization

- Put cross-feature protocol prompts in this directory, such as A2UI and file-workspace output contracts.
- Put feature-specific prompts next to their feature.
- Put deterministic host-rendered A2UI payloads in the feature's `surfaces/` directory instead of embedding them in a system prompt.
- Keep transport services, parsers, UI components, and catalogs free of large prompt templates; they should only import prompt constants or factories.
- Use a factory when a prompt needs request-time context such as the current date, and keep its tests beside the prompt.
