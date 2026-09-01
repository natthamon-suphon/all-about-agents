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

- Keep `gpt-5.6-sol` with max reasoning as the template primary model.
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
