# Session Snapshot Template

Use this template when persisting working memory to `<topic-dir>/SNAPSHOT.md` before or after context compaction.

```markdown
# Session State Snapshot — {TOPIC_SLUG}

- **Snapshot Timestamp:** {ISO_TIMESTAMP}
- **Lead Goal:** {ONE_LINE_OBJECTIVE}
- **Active Plan File:** {PLAN_FILE_PATH}

---

## 1. Execution State & Milestones

| Task # | Name / Component | Status | Commit SHA | Notes / Verdict |
|---|---|---|---|---|
| Task 1 | {Component 1} | COMPLETE | {SHA1} | Review clean |
| Task 2 | {Component 2} | COMPLETE | {SHA2} | 1 minor deferred |
| Task 3 | {Component 3} | IN_PROGRESS | - | Implementing Step 3 |
| Task 4 | {Component 4} | PENDING | - | Blocked on Task 3 |

---

## 2. Inviolable Architectural Decisions

1. **{Decision 1}:** {Rationale and why alternatives were rejected}
2. **{Decision 2}:** {Contract definition and seam location}

---

## 3. Verified State & Test Evidence

- **Baseline Tests:** All {N} existing tests passing.
- **New Regression Tests:** {TEST_FILE_PATH} verified RED then GREEN on Task 1 and 2.
- **Unverified Items:** None.

---

## 4. Immediate Next Step (For Compaction Recovery)

> **Resume here:** Proceed with Task 3 Step 3: Implement minimal code for {FUNCTION_OR_MODULE}.
```
