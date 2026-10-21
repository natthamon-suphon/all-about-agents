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

## Amendment facts - 2026-09-02

Retrieved: 2026-09-02. Observed local CLI: `claude --version` returned
`2.1.258 (Claude Code)` on Windows. The facts in the section above stay the
2026-08-31 record. The facts below are the added evidence for this amendment.

- The [model configuration guide](https://code.claude.com/docs/en/model-config)
  documents `claude-fable-5-1` as the full model name of Fable 5.1, and states
  that Fable 5.1 requires Claude Code v2.1.255 or later. The `fable` alias
  resolves to Fable 5.1 from that version and resolved to Fable 5 before it.
- The same guide documents `xhigh` as an accepted `CLAUDE_CODE_EFFORT_LEVEL`
  value. `xhigh` is the deepest adaptive-reasoning level and `max` is the
  deepest fixed-reasoning level. Both are accepted for Fable 5.1, Fable 5,
  Sonnet 5, and Opus 4.7 and later.
- The same guide states that Fable 5.1, Fable 5, Sonnet 5, and Opus 4.7 and
  later always use adaptive reasoning. It notes that `max` can show
  diminishing returns and is prone to overthinking.
- The same guide states that the persisted `effortLevel` setting and the
  `CLAUDE_CODE_EFFORT_LEVEL` variable do not accept `ultracode`.

## Repository decision and affected fields

Amended 2026-09-02 on operator instruction. The decision below uses the
2026-08-31 facts and the 2026-09-02 amendment facts together.

- Keep the approved template model policy: primary `claude-opus-5`, fallback
  `claude-sonnet-5` at the selected effort level, and advisor
  `claude-fable-5-1` (Fable 5.1).
- Use `CLAUDE_CODE_EFFORT_LEVEL=xhigh` as the effort environment setting.
  `xhigh` is the deepest adaptive-reasoning level, and Opus 5 always uses
  adaptive reasoning. `max` stays the deepest fixed-reasoning level and is
  still accepted, but the guide records an overthinking risk for it.
- Mark the Fable advisor as supported and stable rather than labeling it only
  experimental. Keep explicit account, plan, provider, consent, and product
  version access limits in the notes and diagnostics.
- Use this record as the source for `model.primary`, `model.fallback`,
  `model.advisor`, and `effort.xhigh` in `adapters/claude/capabilities.json`.

## Amendment facts - 2026-09-28

Retrieved: 2026-09-28. Observed local CLI: `claude --version` returned
`2.1.283 (Claude Code)` on Windows.

- The [model configuration guide](https://code.claude.com/docs/en/model-config)
  documents `opus` as "the latest Opus model" and `opus[1m]` as Opus with a
  1 million token context window. The `[1m]` suffix works with aliases and
  full model names.
- A `register --apply` run on 2026-09-28 replaced the operator's
  `"model": "opus[1m]"` with the pinned `claude-opus-5`, which was no longer
  the latest Opus. A pinned full name goes stale each time a new Opus ships.

Amended decision, on operator instruction: the template `model` is
`opus[1m]`, so it follows the latest Opus. The fallback and advisor pins stay
unchanged. `model.primary` in `adapters/claude/capabilities.json` now cites
this amendment.

## Settings refresh - 2026-10-21

The operator requested the configuration audit recommendations in repository
setup, so other Windows and macOS computers receive the same portable policy.
The audit used Claude Code `2.1.306`. These decisions replace the older
repository fallback decision above:

- Keep `opus[1m]`, `CLAUDE_CODE_EFFORT_LEVEL=xhigh`, and the `fable` advisor.
  The [model configuration guide](https://code.claude.com/docs/en/model-config)
  confirms the rolling aliases and the effort setting. Alias targets can
  differ by provider. Availability remains an account and provider condition.
- Render no `fallbackModel` chain for `template`. Native registration removes
  a saved chain when that profile is selected. The same guide separates
  configured server-failure fallback from native content-based fallback.
  Removing the former does not disable the latter.
- Use the built-in `Concise` output style. The
  [output styles guide](https://code.claude.com/docs/en/output-styles#concise)
  says it retains normal engineering thoroughness while shortening replies;
  it requires Claude Code `2.1.237` or later.
- Set `idleCompaction: false`. The
  [settings reference](https://code.claude.com/docs/en/settings-reference#idlecompaction)
  documents this switch separately from normal auto compaction. It keeps
  paused sessions from being summarized only because they are idle. Returning
  after cache expiry can cost more tokens.
- Keep normal auto compaction and auto memory enabled. Leave compaction
  windows, shared memory directories, fixed thinking budgets, and output
  limits unset in the renderer. Existing manual values survive a merge.
- Remove undocumented `autoDreamEnabled` from rendered and registered settings.
  Keep ultracode manual. Do not hardcode a reply language, credentials, proxy,
  companion plugin paths, or host-specific environment values.

The repository policy reference is now `approved-opus`; it replaces the old
internal `approved-opus-sonnet` name. This is a configuration decision, not a
claim that model accuracy improved. No model benchmark was run for this change.

## Unconfirmed

- This session did not authenticate to Claude or make a model request.
- Fable access for the current account and plan was not checked.
- Fable 5.1 and `xhigh` were read from the official guide on 2026-09-02. No
  authenticated session confirmed either value in the product.
- A fallback event was not forced in a native session. The record therefore
  describes the documented contract and not a runtime success.
