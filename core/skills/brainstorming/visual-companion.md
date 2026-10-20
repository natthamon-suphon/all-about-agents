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
- Cleanup canonicalizes the session and the platform temp roots (including
  macOS `/var` and `/tmp` aliases)
  and deletes only a proven disposable `brainstorm-*` folder directly inside
  one of them. Project screens and symlink/junction redirects are never
  recursively removed.

## Start and stop

Prerequisite: Node.js 22.12 or later. Windows and macOS work without Bash.
The `.sh` commands remain optional thin wrappers on hosts with Bash.

From this directory, start after user approval:

```text
node scripts/start-server.cjs --project-dir "PROJECT_DIRECTORY" --open
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

Supported flags are `--project-dir PATH`, `--host HOST`, `--url-host HOST`,
`--idle-timeout-minutes INTEGER`, `--open`, `--allow-remote`, `--foreground`
(`--no-daemon`) and `--background` (`--daemon`, the default). The idle timeout
is four hours by default. It is independent of the short-lived starter shell.
The explicit timeout accepts 1 through 35791 minutes. Inherited companion
settings are discarded. Remote binding still needs explicit user authority.

Stop with the session directory:

```text
node scripts/stop-server.cjs "SESSION_DIRECTORY"
```

The stop command authenticates the exact running instance through a separate
numeric-loopback control listener. A private `control.json` holds a fresh
control secret and unpredictable instance identity. Browser cookies and the
connection URL cannot authorize shutdown. Never copy or log this private file.
Control requests carrying a browser Origin are refused. No metadata hostname,
connection URL or redirect receives the control secret.

Stop closes the matching instance's HTTP, WebSocket and control listeners,
then removes only its validated disposable temp session. It never kills a PID
and never deletes project screens. Results contain `status` and `removed`:
`stopped` means authenticated shutdown and removal; `not_running` means the
session is already absent; `stale` means matching closure evidence or a
demonstrably absent process and control socket allowed cleanup; `refused` means
the whole session was retained because the path, links, identity, authentication
or runtime state was invalid or uncertain. A refusal exits nonzero. Linked
roots, symlinks, junctions and hardlinked cleanup targets are refused.

Filesystem cleanup failures return `status: "error"`, `removed: false`, and
`partial` to state whether any session entries were already removed. Cleanup
is not transactional. The control identity and matching closure proof remain
until other entries are gone. When `retryable` is true, lift the filesystem
error and run the same stop command again; it revalidates the retained proof.
If final proof-file or directory removal fails after that proof is gone,
`retryable` is false. Do not force cleanup or invent ownership in that case.

A failed start prints one bounded JSON `error`. After its directly owned child
has exited, it removes the private session and an empty project screen folder.
If child exit cannot be proved, it retains the session and reports that path.
Neither command follows a shell command supplied by an operator. All starts
make fresh credentials. No telemetry, network dependency or package install
is required.

On Windows, Node.js 24.4.0 can silently leave Unicode paths after `rmSync`.
This lifecycle uses validated `unlinkSync` and `rmdirSync` cleanup instead.

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
