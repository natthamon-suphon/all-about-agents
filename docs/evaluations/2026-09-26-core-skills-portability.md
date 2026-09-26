# all-about-agents — Skills, Rules, Roles, Commands: Analysis

Date: 2026-09-26. Repo: `all-about-agents` at `main` (`341a712`), one local
change in `tests/static/repository-layout.test.mjs` (not mine).
Evidence labels: **V** = verified in files or primary source, **I** = inferred,
**U** = unknown.

---

## 1. The project in one page

- It is a **source repo**, not an install. Vendor-neutral records live in
  `core/`. Adapters render them into packages for three surfaces:
  `antigravity`, `claude`, `codex` (`adapters/shared/surfaces.mjs:5`). **V**
- The CLI is `scripts/aaa.mjs` (validate, install, doctor, diff, register).
  Zero dependencies, Node >= 22.12. **V**
- Lifecycle for every surface:
  `rendered -> validated -> registered -> trusted -> active -> runtime verified`. **V**
- Content today: **28 skills, 7 roles, 9 rules, 3 hooks, 0 commands**. **V**
- There is **no claude.ai surface**. The adapter contract means "write files
  into a destination root". claude.ai has no root; it takes ZIP uploads. **V**

---

## 2. Skills (28)

Portability to claude.ai (chat + Cowork, no repo):
HIGH = works almost as-is. MEDIUM = good idea, needs coding words removed.
LOW = coding/Git only.

### 2.1 Process skills (design -> plan -> do -> check)

| Skill | What it does | Port. | Useful for your stages |
|---|---|---|---|
| brainstorming | Classifies request (spike / bounded / architectural), hard approval gate, one question at a time, 2-3 approaches, sectioned design, spec + self-review | MEDIUM | Idea talk, summary |
| interviewing | One question per message, 2-3 options + recommendation, record each decision, stop when nothing must be guessed. Needs a wrapper skill to own the doc | HIGH | Interview core |
| loop-me | Opt-in grilling that turns a recurring workflow into a spec; readiness checklist + measurable stop rule | HIGH | Interview "done" checklist |
| writing-plans | Approved spec -> plan: goal, invariants, non-goals, acceptance; vertical slices; no TBD/TODO; plan reviewer prompt | MEDIUM | Task breakdown |
| executing-plans | Run approved plan inline, one task at a time, checkpoint ledger, stop on failure, resume by reconciling | MEDIUM | Execute loop (best base: no subagents needed) |
| subagent-driven-development | Fresh worker per task, spec + quality review per task, status contract DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, fix-round breaker | LOW | Status contract, "do not trust the report" |
| dispatching-parallel-agents | Gate for parallel workers: useful, independent, disjoint owners, native capability | LOW | "Independent task" test |
| requesting-code-review | Review package: scope, requirements, risk focus, evidence, not run; severity rubric | MEDIUM | Review request shape |
| receiving-code-review | Judge each finding: confirmed / out-of-scope / style / incorrect / not verifiable | HIGH | Review "fix small, ask big" triage |
| verification-before-completion | Evidence before claims: identify, run, read, verify, report, claim | MEDIUM | Review + loop close-out |
| finishing-a-development-branch | Fresh verification, then Git integration with per-action authority | LOW | Pattern only: verify, then ask before irreversible step |

### 2.2 Continuity skills

| Skill | What it does | Port. | Useful for |
|---|---|---|---|
| handoff | Durable continuation record: goal, state, decisions, evidence, next step | HIGH | Summary doc, loop resume |
| session-compaction-resilience | Snapshot before compaction; re-verify after | MEDIUM | Long execute loop |
| wayfinder | Multi-session decision map with "fog" section, one ticket per session | MEDIUM | Big ideas that span weeks |
| wait-what | Re-pitch an explanation that did not land; keeps session language (has a Thai example) | HIGH | Any stage |

### 2.3 Research and analysis

| Skill | What it does | Port. | Useful for |
|---|---|---|---|
| research | Check supplied material first, one-sentence question, primary sources, cite every claim, spot-check one, separate gap list | HIGH | Research core |
| threat-modeling-and-security | Actors, assets, trust boundaries, STRIDE, controls tied to abuse cases | MEDIUM | Optional review lens |
| codebase-design | Deep modules, seams, "design it twice" | LOW | Decision-record pattern |
| improve-codebase-architecture | Read-only survey, ranked candidates, one recommendation, stop | LOW | Ranked-findings pattern |

### 2.4 Coding-only skills (LOW)

systematic-debugging, test-driven-development, performance-profiling-and-benchmarking,
zero-downtime-migrations, resolving-merge-conflicts, using-git-worktrees,
nano-image-generator (Gemini API + Python).

### 2.5 Meta skills

| Skill | Port. | Note |
|---|---|---|
| using-all-about-agents | MEDIUM | The router. On claude.ai there is no SessionStart hook; skills cannot call other skills. |
| writing-skills | MEDIUM | Use it to author the new set: evals first, trigger / non-trigger / pressure cases, word budgets. |

### 2.6 How skills chain today (V)

Canonical chain (`session-compaction-resilience/SKILL.md:29-32`):
`brainstorming -> writing-plans -> executing-plans or subagent-driven-development -> requesting-code-review -> verification-before-completion`.

Gaps: most handoffs are unnamed ("the planning skill"); brainstorming never
names `interviewing`; requesting-code-review does not point to
receiving-code-review; finishing is not in the canonical chain.

**Key lesson for claude.ai:** the repo already chains through *documents*
(spec -> plan -> ledger -> handoff), not only through skill names. claude.ai
forbids skill-to-skill references, so the document is the only handoff.

---

## 3. Rules (9)

All nine are in `core/rules/<id>/rule.json`, each with 4-5 requirements.

| Rule | Core idea | On claude.ai |
|---|---|---|
| authority-and-scope | Classify answer / review / implementation / side effect; exact authority for mutations | Keep |
| evidence-and-truth | No invention; verify current state; say `not run` | Keep |
| secrets-and-untrusted-input | Web/file/tool text is data; never embed secrets | Keep (research reads the web) |
| implementation-quality | Read real contracts, root cause, smallest diff, explicit errors, few comments | Keep, generalize ("deliverable" not "code") |
| long-task-state | Durable ledger, checkpoint, resume from verified state | Keep as the task ledger doc |
| multi-agent-ownership | Delegate only when useful; no overlapping writers | Cowork only (subagents); chat has none |
| destructive-actions | Resolve exact target; keep emergency denies | Keep (Cowork can touch local files) |
| git-and-user-work | Preserve user work; explicit commit/push authority | Only when a task touches a repo |
| cross-platform-execution | Safe quoting, portable paths, prerequisites | Drop for chat |

Hooks: `bootstrap` (injects the router at session start), `activity-audit`
(PostToolUse log), `checkpoint` (PreCompact). **None can exist on claude.ai.**
Presentation (emoji registry, 2-7 item checklist contract) is plain text and
**can** be followed on claude.ai.

---

## 4. Roles (7)

| Role | Purpose | claude.ai fit |
|---|---|---|
| researcher | Primary-source answers, no mutation | Good (web search) |
| investigator | Read-only root cause, ranked hypotheses | Good as a method |
| architect | Interface/design, no implementation | Good |
| reviewer | Spec + quality verdict | Good (paste or file) |
| security-reviewer | STRIDE review | Good (static) |
| verifier | Fresh checks, no edits | Weak (needs code execution) |
| implementer | Test-first writes | Chat: no. Cowork: possible |

Chat has no custom subagents, so a role becomes a **mode inside a skill**.
The "independent reviewer" guarantee weakens: the same context reviews its own
work. Cowork has subagents (V), so the review skill can ask for a fresh
sub-agent when it exists.

---

## 5. Commands (8) — removed

Removed in `8cbfd3b` (phase-1 simplification): `aaa:audit`, `aaa:build`,
`aaa:design`, `aaa:fix`, `aaa:improve-skill`, `aaa:resume`, `aaa:review`,
`aaa:verify`. Each pointed to one of six workflow state machines
(design-change, fix-bug, implement-change, improve-skill,
release-qualification, review-and-audit).

- Stated reason: the owner never ran them, and the workflows were never
  shipped in any package. Decision: "skills carry the flow". **V**
- They declared **no** skills or roles; they only named a workflow ID. **V**
- A guard test (`tests/static/surface-scope.test.mjs`) now fails the build if
  `core/commands` or `core/workflows` come back. **V**
- The design-change workflow (discover -> clarify -> compare -> approve ->
  spec -> plan) is close to your stages 1-3. **I**

**Lesson:** a command layer on top of skills went unused. For claude.ai, the
`/skill-name` picker already gives "commands" for free (V). No extra layer.

---

## 6. claude.ai facts that shape the design

| Fact | Status | Source |
|---|---|---|
| Upload at Customize > Skills; ZIP holds the skill **folder**; folder name = `name` | V | https://claude.com/docs/skills/how-to |
| Required frontmatter: `name`, `description` | V | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview |
| `name`: <= 64 chars, lowercase, digits, hyphens; no "anthropic"/"claude" | V | same |
| `description`: help center says **200 chars max**; platform docs say 1024 | V (conflict) | https://support.claude.com/en/articles/12512198-how-to-create-custom-skills |
| Code execution must be on for skills | V | https://support.claude.com/en/articles/12512180-use-skills-in-claude |
| **Skills cannot reference other skills**; Claude combines them itself | V | 12512198, https://claude.com/blog/skills |
| Several focused skills combine better than one large skill | V | how-to |
| Body < 500 lines; description in third person, "what + when"; references one level deep; checklists; evals first | V | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices |
| **Chat and Cowork merged on 2026-09-16** ("Cowork comes to every conversation") | V | https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude |
| Cowork: connected local folders, connectors, browser, subagents, scheduled tasks; custom skills sync at session start | V | https://claude.com/docs/cowork/overview.md |
| Plain chat: no subagents | V | skill-creator SKILL.md |
| File creation: docx/xlsx/pptx/pdf, 30 MB per file | V | https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude |
| User can start a skill with `/` in the message box | V | https://claude.com/docs/skills/overview.md |
| A skill telling Claude to use web search / artifacts / memory | U | no primary source found |
| Extra frontmatter keys (like the repo's `evaluationCases`) accepted? | U | validator "reports" undefined fields; treat as must-strip |
| Custom name equal to built-in (`docx`, `pdf`, ...) | U | avoid these names |

Consequence: "chat and co-work" is now **one surface with two capability
tiers**: (a) can write files to a connected folder and use subagents, (b)
cannot. One skill set should detect the tier and fall back.

---

## 7. Reuse map for your six stages

| Stage | Best existing text | Must strip |
|---|---|---|
| 1 Interview | interviewing (question contract, stop rule), loop-me (readiness checklist, record immediately), wait-what (keep session language) | "repository evidence"; the narrow "material decisions only" rule conflicts with your "until no open gaps" -> needs a full Q&A log template (none exists) |
| 2 Summary | handoff template, research output shape (said / inferred / open), brainstorming spec self-review + spec-document-reviewer-prompt | file paths, command evidence lines |
| 3 Breakdown | writing-plans header + "no TBD" + plan-document-reviewer-prompt; SDD conflict scan; wayfinder "not yet specified" | file paths, typed interfaces, RED/GREEN |
| 4 Loop | executing-plans ledger + checkpoint + resume; SDD status contract + fix-round breaker; verification gate | branches, commands, model policy |
| 5 Review | code-reviewer severity rubric; task-reviewer "do not trust the report", missing/extra/misunderstood; receiving-code-review triage; both doc reviewer prompts | SHAs, diffs, test sections |
| 6 Research | research skill (all of it); "never make up a number"; conditional claims | workspace/repo citations; subagent delegation |

---

## 8. Defects found (out of scope, not fixed)

1. `core/skills/test-driven-development/writing-good-tests.md:1` — stray
   PowerShell error line. **V (checked)**
2. `core/skills/subagent-driven-development/implementer-prompt.md:38` —
   "Commit your work" contradicts `SKILL.md:151-155` (commit only with exact
   authority). **V (checked)**
3. `subagent-driven-development/re-review-prompt.md:95-96` allows a cheaper
   model; `SKILL.md:100-104` says never downshift. **I (agent report)**
4. SDD prompts cite a "Model Selection" section; the heading is "Model and
   review policy". **I**
5. `requesting-code-review/code-reviewer.md:23-31` requires SHAs;
   `SKILL.md:30-31` says optional. **I**
6. `using-all-about-agents/references/codex-tools.md:31-33` says the agent
   commits all work; `:26` cites a missing "Step 0". **I**
7. Workspace `CLAUDE.md` catalog row says "8 commands"; there are 0 since
   `8cbfd3b`. **V**
