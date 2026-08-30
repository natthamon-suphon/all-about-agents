# Historical Vendor Notes

This companion preserves historical/vendor-specific skill-authoring ideas for
comparison. It is not a current portable contract. Re-verify every product,
frontmatter, discovery-path, tool, hook, model, context, and packaging claim
against current official vendor documentation before applying it.

## Durable ideas

- A routing description should say when the skill applies, not summarize all
  instructions.
- The main file should make the first correct decision while references hold
  specialized detail behind progressive disclosure.
- Examples should show realistic inputs, observable outputs, and failure cases.
- Skills need trigger, nontrigger, and pressure evaluation rather than prose
  review alone.
- Referenced scripts and assets are part of installation and must be tested at
  their installed paths.

## Time-sensitive areas

Treat product names, model families, native fields, tool permissions, context
limits, hook events, install locations, marketplace behavior, and UI/CLI parity
as time-sensitive. Keep them in the owning adapter or vendor reference, attach a
verification date/source, and fail closed when no current evidence exists.

## Use

Consult this file only when a concrete vendor integration decision requires
historical context. Portable behavioral rules in `SKILL.md` take precedence.
When current official documentation disagrees, update or retire this note and
record the source; never preserve folklore for compatibility.
