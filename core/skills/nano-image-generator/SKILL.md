---
name: nano-image-generator
description: Use when the user explicitly requests a new raster image and no already-available native image-generation capability is the better authorized path
evaluationCases:
  - NI-TRIGGER-explicit-image-generation
  - NI-NONTRIGGER-code-native-SVG
  - NI-PRESSURE-missing-key-stale-model
---

# Nano Image Generator

Generate a raster image through the Gemini API only after routing, prerequisite,
model-availability, cost/authority, and output checks pass. Model names and API
features change; the bundled runtime validates the selected model rather than
silently trusting a stale nickname or preview slug.

A code-native SVG, existing icon-system extension, HTML/CSS/canvas visual, or
repository-native vector asset is a nontrigger when ordinary code editing can
produce the requested result more accurately. Prefer an authorized native image
tool already available on the current surface before this API fallback.

## Skill Gate Protocol

1. **Confirm the artifact.** Establish raster versus vector/code-native output,
   purpose, dimensions/aspect, style, composition, required text, accessibility,
   reference-image rights, and exact output path. Do not infer permission to
   upload private reference material.
2. **Confirm authority and cost.** A generation request can consume paid quota
   and send prompt/reference data to an external service. Obtain separate,
   explicit authority for the paid request. Reading this skill or checking local
   files is not that authority.
3. **Check prerequisites without disclosure.** Require supported Python, an API
   key in `GOOGLE_API_KEY` or `GEMINI_API_KEY`, and an explicit model selection
   or the documented default. Never print, log, place in a URL/query string, or
   persist the credential.
4. **Validate the model at runtime.** Use the Gemini Models API to confirm the
   selected model exists and supports `generateContent`. If the key is missing,
   the model is unavailable, or access is denied, stop with a redacted error and
   current discovery guidance; never substitute an unverified slug.
5. **Preview the operation.** State model, aspect/size when specified, output
   path, overwrite behavior, and that one external paid request will occur.
   Do not echo a sensitive prompt.
6. **Generate once.** Invoke the bundled argument-vector command with
   `--authorize-paid-request`. The runtime sends the credential only in the
   documented `x-goog-api-key` header and bounds response sizes.
7. **Validate before writing.** Strictly decode base64, require a known PNG,
   JPEG, WebP, or GIF magic signature, require the reported MIME type to match,
   and reject unknown image bytes. Write atomically to the explicit destination;
   overwrite only with `--overwrite`.
8. **Verify and report.** Confirm the produced file exists, has the detected
   format, and is usable for the requested purpose. Visually inspect when a
   local viewer is available. Report the exact path and any checks `not run`.

## Runtime

Preflight model access without generating an image:

```text
python <bundled-skill-runtime> --check
```

Generate only after explicit paid-request authority:

```text
python <bundled-skill-runtime> "<prompt>" --output "<path>" --aspect 1:1 --size 2K --authorize-paid-request
```

Resolve `<bundled-skill-runtime>` to the sole Python file in this skill's
inventory-owned `scripts/` directory. Pass arguments as an argument vector; do
not build a shell string. Select a non-default model through the documented
`GEMINI_IMAGE_MODEL` environment variable after runtime discovery. Omit aspect
or size to use the model's current default. Use `--overwrite` only when replacing
the exact destination was explicitly authorized.

Official contracts to recheck when behavior changes:

- Models API: <https://ai.google.dev/api/models>
- GenerateContent API: <https://ai.google.dev/api/generate-content>
- API-key handling: <https://ai.google.dev/gemini-api/docs/api-key>

## Prompt and output quality

Describe subject, purpose, medium/style, composition, palette, lighting, camera
or perspective, background, and constraints. Treat requested brand assets,
people, copyrighted references, and embedded text as requirements requiring
careful review—not as permission to acquire or upload source material. Prefer
adding exact long text with ordinary layout tools after generation.

The runtime deliberately does not dump API error bodies, candidate text, prompt
contents, or raw responses because they can contain secrets or sensitive data.
Redacted failure evidence is sufficient for model/access diagnosis.

## Failure handling

- Missing key/prerequisite: stop before network or file mutation.
- Missing paid authority: stop before model lookup or generation.
- Unknown/stale model: report unavailable after the Models API check; require a
  caller-selected available image model rather than guessing a replacement.
- HTTP, JSON, response-shape, base64, MIME, signature, or size failure: emit a
  bounded redacted error and do not create/replace the output.
- Existing destination: stop unless `--overwrite` was explicitly supplied.

## Completion checklist

- [ ] Raster routing and user intent are explicit; SVG/code-native cases stayed out.
- [ ] Reference-data rights and paid external-request authority are explicit.
- [ ] Prerequisites and current model availability passed without key disclosure.
- [ ] Prompt/options/output path were reviewed without sensitive logging.
- [ ] Base64, MIME, magic bytes, response bounds, and atomic output passed.
- [ ] Visual/file verification and every not-run check are reported.
