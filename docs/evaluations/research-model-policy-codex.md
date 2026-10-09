# Codex model policy evidence - 2026-08-31

Retrieved: 2026-08-31

Observed local CLI: `codex --version` returned
`codex-cli 0.151.0-alpha.7.2` on Windows. The model policy is scoped to the
official catalog and this CLI observation on 2026-08-31.

## Official contract facts

- [Codex models](https://developers.openai.com/codex/models) lists `gpt-5.6-sol`
  as the flagship model for complex coding and lists the CLI selection
  command `codex -m gpt-5.6-sol`.
- [Codex models](https://developers.openai.com/codex/models) lists
  `gpt-5.6-terra` as the balanced everyday model and lists the CLI selection
  command `codex -m gpt-5.6-terra`.
- The [Codex models guide](https://developers.openai.com/codex/models) documents
  reasoning effort choices and says Max gives the selected model more time for
  one task. The exact available controls can vary by surface and account.
- The [Codex hooks](https://developers.openai.com/codex/hooks) and [Codex
  plugins](https://developers.openai.com/codex/plugins) guides do not document
  a setting that automatically changes a failed Sol request to Terra.
  Therefore an automatic Sol-to-Terra fallback claim is not supported.

## Repository decision and affected fields

- Keep `gpt-6.1-sol` with xhigh reasoning as the template primary model
  (changed on 2026-10-09; `gpt-5.6-sol` with max was the primary before, see
  the update below).
- Keep `gpt-5.6-terra` with max reasoning as the explicit `terra-max` recovery
  profile. The operator selects it; the repository does not silently switch.
- Keep `model.automatic-fallback` unsupported and keep its note explicit.
- Use this record as the source for model and effort capabilities in
  `adapters/codex/capabilities.json`.

## Unconfirmed

- No authenticated model request was made from the isolated CLI in this
  session.
- The availability of either model for a specific account, plan, or provider
  was not checked.
- The alpha CLI's native profile parsing and any desktop model picker behavior
  require separate checks.

## Update 2026-10-09 (macOS, Codex CLI 0.162.0)

- `~/.codex/models_cache.json` listed `gpt-6.1-sol`, `gpt-6-astra`,
  `gpt-6-sol`, `gpt-6-luna`, `gpt-reserve`, `gpt-5.6-sol`, `gpt-5.6-terra`,
  `gpt-5.6-luna`, `gpt-5.5`, and `codex-auto-review`. `gpt-6.1-sol` advertises
  low, medium, high, xhigh, max, and ultra reasoning.
- The ChatGPT desktop app wrote `model = "gpt-6.1-sol"` and
  `model_reasoning_effort = "xhigh"` into `~/.codex/config.toml` on launch. The
  owner chose that pair as the template primary so the rendered file and the
  app stop disagreeing.
- A `codex exec` session reported `model: gpt-6.1-sol`, `reasoning effort:
  xhigh`. No cost, quota, or quality comparison with `gpt-5.6-sol` was made.
