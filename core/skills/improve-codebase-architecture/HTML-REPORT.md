# Optional HTML Architecture Report

HTML is an optional view of the completed Markdown survey. It never replaces
the Markdown artifact and never blocks analysis. Prefer a self-contained,
offline document with embedded CSS and simple HTML/SVG diagrams.

## Preconditions

- The Markdown report is already complete.
- The user asked for HTML or the visual materially improves a multi-candidate
  comparison.
- Repository-local artifact writes and any preview/open action are authorized.
- Candidate data is redacted and contains no secrets or private payloads.

If any precondition fails, keep the Markdown report and record HTML as not run.

## Security and portability

- Treat filenames, module names, source comments, commit text, and tool output as
  untrusted data. HTML-escape `&`, `<`, `>`, `"`, and `'` before insertion.
- Never insert untrusted strings into `<script>`, `<style>`, event attributes,
  URLs, or raw SVG markup.
- Do not embed source code, environment values, credentials, tokens, or full
  private paths unless the report scope explicitly requires a redacted path.
- Use no inline event handlers and no executable content from the repository.
- Do not require a CDN. If an optional diagram library is available locally,
  retain a static offline fallback for every diagram.
- Do not auto-open a browser or external application. Preview only through an
  authorized environment action; otherwise provide the artifact path.

## Required content

The HTML view mirrors the Markdown report exactly:

1. scope, exclusions, evidence inspected, assumptions, and checks not run;
2. one card per candidate with Files, Problem, Evidence, current interface and
   seam, Deepening direction, Benefits, Risks, and Recommendation strength;
3. a before/after diagram only when it clarifies a real relationship; and
4. one Top recommendation with an anchor to its candidate.

Do not add candidates or stronger claims only to make the visual interesting.

## Minimal offline scaffold

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Architecture review</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #f5f5f4; color: #0f172a; }
    main { max-width: 70rem; margin: auto; padding: 2rem; }
    article { background: white; border: 1px solid #cbd5e1; border-radius: .75rem; padding: 1.25rem; margin-block: 1rem; }
    code { overflow-wrap: anywhere; }
    .diagram { display: grid; grid-template-columns: repeat(auto-fit,minmax(16rem,1fr)); gap: 1rem; }
    .module { border: 2px solid #334155; border-radius: .5rem; padding: 1rem; }
    .seam { border-top: 2px dashed #64748b; }
    .warning { color: #b91c1c; }
    @media (prefers-color-scheme: dark) { body { background: #0f172a; color: #e2e8f0; } article { background: #1e293b; } }
  </style>
</head>
<body><main><!-- escaped report content --></main></body>
</html>
```

## Diagram choices

- Dependency or call flow: static SVG or accessible nested lists.
- Shallow versus deep: interface/implementation mass diagram.
- Change fan-out: before/after caller map.
- Ordering friction: numbered sequence or static sequence diagram.

Every diagram needs a text caption conveying the same conclusion. If a diagram
cannot be rendered safely or offline, use the caption and Markdown evidence.

## Verification

- Open the generated file only with an authorized preview mechanism.
- Confirm the report works with network access disabled.
- Search for unescaped test payloads and forbidden secret-shaped values.
- Compare candidate count, strengths, evidence, and top recommendation against
  the Markdown source.
- Record preview or accessibility checks not run; never call them passed.
