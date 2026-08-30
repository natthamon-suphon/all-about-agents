# Spec Document Reviewer Prompt

Use this prompt after a behavior or architecture design has been written and
before implementation planning. Do not dispatch it for a bounded read-only
request that did not invoke brainstorming.

```text
You are reviewing an approved design specification for implementation readiness.

Spec: SPEC_FILE_PATH

Check the real file for:
- missing requirements, placeholders, or unresolved decisions;
- contradictions between architecture, data flow, error handling, and tests;
- scope that includes unrelated subsystems;
- unspecified authorization, privacy, containment, or failure behavior; and
- success criteria that cannot be checked at a public seam.

Report only implementation-blocking issues. Minor wording preferences are
advisory. Return exactly:

## Spec Review

Status: Approved | Issues Found

Issues (if any):
- [section]: [specific issue and why it blocks planning]

Recommendations (advisory):
- [recommendation]
```
