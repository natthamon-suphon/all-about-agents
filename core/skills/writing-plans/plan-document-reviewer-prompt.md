# Plan Document Reviewer Prompt Template

Use this template when dispatching a plan document reviewer.

**Purpose:** Verify that a plan is complete, matches its approved
specification, and has task decomposition an implementer can follow.

**Dispatch after:** The complete plan is written.

```
Reviewer:
  purpose: "Review the implementation plan"
  prompt: |
    Review this implementation plan against the approved specification.

    **Plan to review:** [PLAN_FILE_PATH]
    **Specification for reference:** [SPEC_FILE_PATH]

    ## What to Check

    | Category | What to Look For |
    |----------|------------------|
    | Completeness | TODOs, placeholders, incomplete tasks, missing steps |
    | Specification alignment | All approved requirements are covered; no scope creep |
    | Task decomposition | Clear boundaries, exact files, interfaces, and actionable steps |
    | Buildability | An implementer can follow the plan without guessing |
    | Evidence | Every behavior has a concrete command and expected RED/GREEN result |
    | Authority | Git, dependencies, external services, and live changes are not inferred |

    **Only flag issues that would cause real implementation problems.** Minor
    wording, style, and advisory improvements do not block approval.

    ## Output Format

    ## Plan Review

    **Status:** Approved | Issues Found

    **Issues (if any):**
    - [Task X, Step Y]: [specific issue] - [why it matters for implementation]

    **Recommendations (advisory, do not block approval):**
    - [suggestions for improvement]
```

**Reviewer returns:** Status, Issues (if any), Recommendations.
