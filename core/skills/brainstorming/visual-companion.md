# Visual Companion Guide

The visual companion is an optional browser surface for genuinely visual
questions: mockups, wireframes, spatial layouts, diagrams, or side-by-side
visual comparisons. It is offered just in time, after the user accepts it, and
is never required for a text-only or trivial read-only request.

## Security contract

- Bind to `127.0.0.1` (or another loopback address) by default. A remote bind
  requires an explicit `--allow-remote` acknowledgement and
  `BRAINSTORM_ALLOW_REMOTE=1`; never expose a companion accidentally.
- The session key is delivered only in the complete, private connection URL.
  Keep it out of screenshots, event values, console logs, and ordinary server
  metadata. `server-info` is safe metadata; `connection-url` is owner-only.
- The server sends a restrictive Content-Security-Policy with no external
  origins, denies framing, and disables object, form, media, and font access.
- Browser launch uses an executable plus an argument array. Do not construct a
  shell command from a URL or accept an operator-provided command string.
- WebSocket frames, events, event fields, queued events, connections, and the
  event log are bounded. Oversized or malformed input is dropped safely.
- Event records contain only the small allowlisted fields needed for choices;
  values are control-sanitized and the session key is redacted.
- Cleanup canonicalizes the requested session root and deletes only a proven
  disposable `/tmp/brainstorm-*` descendant. Persistent project sessions and
  symlink/junction redirects are never recursively removed.

## Start and stop

From this directory, start after user approval:

```text
scripts/start-server.sh --project-dir PROJECT_DIRECTORY --open
```

The command prints one JSON object containing the complete keyed URL and the
session directories. Keep the query key intact. On Windows-like shells, use a
persistent terminal if the environment cannot retain a foreground process.

Stop with the exact session directory from the start result:

```text
scripts/stop-server.sh SESSION_DIRECTORY
```

The stop operation fails closed on a stale or unproven PID and never treats a
project-backed session as disposable.

## Per-question loop

1. Confirm the browser would make this decision clearer than text.
2. Offer the companion and wait for acceptance before starting it.
3. Check `state/server-info` exists and `state/server-stopped` does not before
   referring to the URL or pushing a screen.
4. Write a fresh semantic HTML filename for each screen; do not reuse names.
5. Read `state/events` after the user responds, then combine those bounded
   events with the user's terminal feedback.
6. Stop or replace the companion when the work returns to a text-only question.

Content fragments are preferred: the server supplies the frame, styles, and
bounded helper. A full document is appropriate only when the screen needs full
control of its markup.
