# Visual Companion Guide

The visual companion is an optional browser surface for genuinely visual
questions: mockups, wireframes, spatial layouts, diagrams, or side-by-side
visual comparisons. It is offered just in time, after the user accepts it, and
is never required for a text-only or trivial read-only request.

## Security contract

- Bind to `127.0.0.1` (or another loopback address) by default. A remote bind
  requires the explicit `--allow-remote` flag; the environment never enables
  it. Never expose a companion accidentally.
- Every start makes a new session key and delivers it only in the complete
  connection URL. On disk it is kept only in the owner-only temp state folder;
  it is never written into the project or reused by a later start. Keep it
  out of screenshots, event values, console logs, and ordinary server
  metadata. `server-info` is safe metadata; `connection-url` is owner-only.
- Residual risks: the key cookie is scoped to the host, not the port, so other
  local servers on the same host name receive it; the keyed URL also appears
  in the browser launcher's arguments (visible in the local process list while
  it runs) and in browser history. The key works only while that session runs.
- The server sends a restrictive Content-Security-Policy with no external
  origins, denies framing, and disables object, form, media, and font access.
- Browser launch uses an executable plus an argument array. Do not construct a
  shell command from a URL or accept an operator-provided command string.
- WebSocket frames, events, event fields, queued events, connections, and the
  event log are bounded. Oversized or malformed input is dropped safely.
- Event records contain only the small allowlisted fields needed for choices;
  values are control-sanitized and the session key is redacted.
- Cleanup canonicalizes the session and the temp roots (`TMPDIR` and `/tmp`)
  and deletes only a proven disposable `brainstorm-*` folder directly inside
  one of them. Project screens and symlink/junction redirects are never
  recursively removed.

## Start and stop

Prerequisites: `bash` and `node` on the PATH. On Windows, use Git Bash or WSL.

From this directory, start after user approval:

```text
bash scripts/start-server.sh --project-dir PROJECT_DIRECTORY --open
```

The command prints one JSON object with the complete keyed `url`, the
`screen_dir`, and the `state_dir`. Keep the query key intact. The session
directory is the parent of `state_dir`, a private temp folder. With
`--project-dir`, screens are kept in a folder under
`PROJECT_DIRECTORY/.aaa/brainstorm/` so they outlive the session; without it,
they stay in the temp session.

The server runs as a background process. If the host stops background
processes when the command returns, start with `--foreground` in a terminal or
background task that stays open.

Stop with the session directory:

```text
bash scripts/stop-server.sh SESSION_DIRECTORY
```

The stop operation acts only on a proven disposable temp session and refuses
any other path untouched. It never kills a stale or unproven PID, reports
`"removed": true` or `false`, and never deletes project screens.

A failed start prints an `error`. A crash also names the kept `log`: its state
folder then holds only that redacted `server.log`, with no key, PID, or
instance id. Stop that session directory (the parent of the log's folder) to
remove it.

## Screen contract

- Write each screen as a new `.html` file in `screen_dir`. The browser shows
  the newest file; a new filename clears `events` in `state_dir` and reloads
  the page.
- Prefer a content fragment: the server wraps it in the frame, its styles, and
  the bounded helper. Start with `<!doctype html>` or `<html>` only when the
  screen needs full control of its markup.
- A click is recorded only on an element with a `data-choice="VALUE"`
  attribute, or through a script call to `window.brainstorm.choice(VALUE)`.
  Anything else records nothing.
- Frame classes: `.options` holding `.option` items (with `.letter` and
  `.content`), `.cards` holding `.card` items (with `.card-image` and
  `.card-body`), and `.mockup` with `.mockup-header` and `.mockup-body`. Add
  `data-multiselect` to the container for multiple picks and
  `onclick="toggleSelect(this)"` to highlight the selection.
- `events` holds one JSON object per line. Read it before you write the next
  screen, because the next screen clears it.

## Per-question loop

1. Confirm the browser would make this decision clearer than text.
2. Offer the companion and wait for acceptance before starting it.
3. Check that `server-info` exists and `server-stopped` does not in
   `state_dir` before referring to the URL or pushing a screen.
   `server-stopped` carries the reason.
4. Write a fresh semantic HTML filename in `screen_dir` for each screen; do
   not reuse names.
5. After the user responds, read `events` in `state_dir` before you write the
   next screen, then combine those bounded events with the user's terminal
   feedback.
6. Stop or replace the companion when the work returns to a text-only question.
