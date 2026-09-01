# Claude Code model policy evidence - 2026-08-31

Retrieved: 2026-08-31

Observed local CLI: `claude --version` returned `2.1.251 (Claude Code)` on
Windows. The model facts below are version-scoped to the official documentation
retrieved on this date.

## Official contract facts

- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
  documents full model names, the `model` setting, model aliases, and the
  `fallbackModel` array. The page identifies `claude-opus-5` and
  `claude-sonnet-5` as the current API alias targets and explains that full
  names can pin a version.
- The same [model configuration guide](https://code.claude.com/docs/en/model-config)
  documents `claude-fable-5` as Fable 5, the `fable` selector, and the
  `ANTHROPIC_DEFAULT_FABLE_MODEL` mapping. Fable 5 requires Claude Code
  v2.1.170 or later and availability depends on the account, organization,
  plan, provider, and product conditions. Some uses require usage-credit
  consent; zero-data-retention access can omit or disable Fable.
- The [model configuration guide](https://code.claude.com/docs/en/model-config)
  documents `CLAUDE_CODE_EFFORT_LEVEL`, including `max` as the deepest effort
  level for supported models. It also documents model-specific effort limits.
- The [model configuration guide](https://code.claude.com/docs/en/model-config)
  documents availability-based fallback chains and content-based fallback for
  some Fable 5 and Opus 5 requests. These are Claude Code behaviors, not a
  promise that every provider or account will expose every model.

## Repository decision and affected fields

- Keep the approved template model policy: primary `claude-opus-5`, fallback
  `claude-sonnet-5` at max effort, and advisor `claude-fable-5`.
- Keep `CLAUDE_CODE_EFFORT_LEVEL=max` as the max-effort environment setting.
- Mark the Fable advisor as supported and stable rather than labeling it only
  experimental. Keep explicit account, plan, provider, consent, and product
  version access limits in the notes and diagnostics.
- Use this record as the source for `model.primary`, `model.fallback`,
  `model.advisor`, and `effort.max` in `adapters/claude/capabilities.json`.

## Unconfirmed

- This session did not authenticate to Claude or make a model request.
- Fable access for the current account and plan was not checked.
- A fallback event was not forced in a native session. The record therefore
  describes the documented contract and not a runtime success.
