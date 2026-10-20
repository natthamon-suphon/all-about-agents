# ADR Format

Use the repository's existing decision directory and conventions.
Otherwise use `docs/adr/` within the relevant context. Create it lazily
when the first real decision qualifies. Inspect the highest existing number
and increment it, for example `0001-order-events.md`; never overwrite an
existing decision.

Offer an ADR only if the decision is hard to reverse, surprising without
context and the result of a real trade-off with genuine alternatives.
A reversible name or routine library use usually does not qualify.

```markdown
# Order events cross the billing boundary

Billing consumes order events so ordering can accept orders while billing
is unavailable. We accept delayed invoice visibility instead of coupling
order acceptance to a synchronous billing call.
```

One to three sentences can record context, decision and reason.
Add status, rejected alternatives or consequences only when they help future
readers. Mark an unresolved choice proposed rather than accepted. Revisit or
supersede existing ADRs explicitly; preserve their history.

Adapted from Matt Pocock's
[ADR-FORMAT.md](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/domain-modeling/ADR-FORMAT.md).
