# Glossary Format

Follow an existing `GLOSSARY-MAP.md` to the relevant context. Otherwise use
the existing root glossary. Create a glossary lazily when the first
domain-specific term resolves; do not create empty files or a context map
for a hypothetical split.

```markdown
# Ordering

Receives and tracks customer orders.

## Language

**Customer**:
A person or organization that places an order.
_Avoid_: Buyer, client, account
```

Define each term in one or two sentences. Pick a canonical name and list
misleading alternatives under `_Avoid_`. Include domain-specific vocabulary,
not general programming concepts, tables, class names or implementation
decisions. Add subheadings only when actual clusters improve navigation.

For multiple established contexts, a map lists each glossary's relative
location, responsibility and relationships. The same word may have distinct
meanings in different contexts; preserve those boundaries. When legacy
`CONTEXT.md` carries vocabulary or decisions, read and preserve it; propose
a migration rather than silently renaming or deleting it.

Adapted from Matt Pocock's
[GLOSSARY-FORMAT.md](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/domain-modeling/GLOSSARY-FORMAT.md).
