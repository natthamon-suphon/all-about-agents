---
name: improve-codebase-architecture
description: Use when asked to survey a codebase for refactoring or deepening opportunities - scans for shallow modules, presents candidates as a visual HTML report, then works through whichever one your human partner picks
disable-model-invocation: true
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

**Announce at start:** "I'm using the improve-codebase-architecture skill to survey for deepening opportunities."

**This is a survey, not a rescue.** On a genuinely tangled codebase it will find real candidates; it will not untangle the mud for you. Deepening happens later, through the normal design → plan → implement path.

**REQUIRED BACKGROUND:** You MUST read `all-about-agents:codebase-design` before starting. It is the source of the architecture vocabulary (**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles (the deletion test, "the interface is the test surface", "one adapter = hypothetical seam, two = real"). Use those terms exactly in every suggestion — don't drift into "component," "service," "API," or "boundary."

## Process

### 1. Explore

**Scope before you scan — YAGNI.** Deepening a module pays off by making future changes to it easier, so put extra weight on the parts of the codebase that have recently changed. Decide *where* to look before you look:

- If your human partner named a direction — a module, a subsystem, a pain point — take it, and skip the inference below.
- Otherwise, walk back a good stretch of the commit history (`git log --oneline`) to find the codebase's hot spots — the files and areas that keep coming up — and let those paths pull your attention first. If the changes are scattered with no clear hot spot, widen the net.

Then dispatch a subagent to walk the codebase (`all-about-agents:dispatching-parallel-agents` if the scope splits cleanly into independent areas). Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates as an HTML report

Write a self-contained HTML file to `.claude/all-about-agents/architecture-review/report-<timestamp>.html`, creating the directory if it does not exist. The timestamp gives each run a fresh file. Open it — `xdg-open <path>` on Linux, `open <path>` on macOS, `start <path>` on Windows — and tell your human partner the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals — use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs/SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations). Each candidate gets a **before/after visualisation**. Be visual.

For each candidate, render a card with:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and how tests would improve
- **Before / After diagram** — side-by-side, custom-drawn, illustrating the shallowness and the deepening
- **Recommendation strength** — one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

See [HTML-REPORT.md](HTML-REPORT.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet. After the file is written, ask: "Which of these would you like to explore?"

### 3. Design the chosen candidate

Once your human partner picks a candidate, use `all-about-agents:brainstorming` to walk the design with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive. That skill runs on `all-about-agents:interviewing` and ends where it should: a written design, then a plan.

Two references carry the load during that conversation:

- **Dependency categories and seam discipline** — [DEEPENING.md](../codebase-design/DEEPENING.md). Classify the candidate's dependencies first; the category determines how the deepened module gets tested across its seam.
- **Alternative interfaces** — if the right interface is genuinely unclear, use the design-it-twice pattern in [DESIGN-IT-TWICE.md](../codebase-design/DESIGN-IT-TWICE.md) to explore several radically different shapes in parallel before choosing.

When the design is approved, hand off through the normal path: `all-about-agents:writing-plans`, then `all-about-agents:subagent-driven-development` (or `all-about-agents:executing-plans` where subagents aren't available). Deepening a module is a refactor with a real blast radius — it does not get implemented ad hoc from a report card.
