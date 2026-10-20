# Instructions for Claude, ChatGPT, and Gemini on the web

Copy the contents of the matching plain-text file into the product's
instruction field. No Markdown import, installer, Node.js, or plugin is needed
for this step. The same text works from a browser on Windows or macOS.

| Product | Text to copy | Where to paste it |
| --- | --- | --- |
| Claude web | [claude-web.txt](../instructions/claude-web.txt) | Settings, then **Instructions for Claude**. |
| ChatGPT web | [chatgpt-web.txt](../instructions/chatgpt-web.txt) | Settings > Personalization, then **Custom instructions**. |
| Gemini web | [gemini-web.txt](../instructions/gemini-web.txt) | Settings & help > Personal Intelligence > Instructions for Gemini > Add. |

Before saving, read any existing instructions and keep the preferences you
still need. Remove direct conflicts, such as an older rule that always forces
English. Copy the text itself, without file names, code fences, or this guide.
Use the product's save or submit control, then start a new chat to check it.
If a field rejects the text, do not silently cut off the end. Gemini's Add
control can hold separate instruction entries; use one paragraph per entry
when needed. Check the current field and account controls before saving.

The official setup sources, read on 2026-10-20, are
[Claude personalization](https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features),
[ChatGPT personalization](https://learn.chatgpt.com/docs/personalize), and
[Gemini instructions](https://support.google.com/gemini/answer/16598625?co=GENIE.Platform%3DDesktop&hl=en).
The [ChatGPT prompting guide](https://learn.chatgpt.com/docs/prompting) also
names Settings > Personalization as the place for custom instructions.
The ChatGPT source confirms custom instructions across chats; it does not
document a current field-size limit. The ChatGPT text uses a repository budget
of 1,500 characters, including line breaks, rather than a claimed vendor limit.
The sources reviewed do not establish current field-size limits for Claude or
Gemini either. Saving the complete text in the owner's account remains a
manual check. Labels and available controls may differ by account or rollout.
The Gemini page distinguishes adding instructions from its separate Memory
feature; do not assume that the Memory feature's plan or region requirements
also describe the instruction field.

## What the text preserves

All three files retain the same core behavior:

- Follow the session language. Use English at CEFR A1-A2 only if it is unclear.
- Answer first, very briefly, with enough detail for clarity and safety.
- Prefer zero code comments; explain only non-obvious intent, constraints, or
  required notices.
- Apply the four Karpathy principles: think before coding, simplicity first,
  surgical changes, and execution with observable success checks.
- Keep unrelated work intact. Check relevant Windows and macOS behavior.
- Use real evidence and available capabilities. State uncertainty and checks
  not run. Keep secrets private and external actions within authorized scope.

These files are manually maintained web summaries of
[the shared global rules](../../core/instructions/global-operating-rules.md).
The Claude and Gemini versions provide more detail; the ChatGPT version is
compact. None imports the shared Markdown source. When shared behavior
changes, review all three text files and keep the ChatGPT budget intact.
See [the global instruction guide](../maintenance/global-instructions.md) for
the coding-tool version of the rules.

## Account preferences and task context

Use the account instruction field for stable preferences. Put project facts,
requirements, source files, and commands in the relevant project's instructions
or current chat. Claude documents project instructions separately from account
instructions in the source above. An attached Markdown file can provide task
data; attaching it does not install these account preferences.

If a project, custom assistant, Gem, or other mode does not inherit account
instructions, place the matching text in that mode's instruction field when
available, or paste it at the start of that chat. This is a fallback, not a
claim that account instructions apply to every mode. Check each mode you use.

These are behavioral instructions. They do not install or activate Ponytail,
Caveman, Context7, RTK, ui-ux-pro-max, frontend-design, karpathy-guidelines, or
this repository's skills. Use a companion only when that web conversation
actually exposes it. The four Karpathy principles remain usable without the
external skill. The separate [claude.ai skill pack](claude-ai.md) still uses
its own upload and verification flow.

The files do not change model selection, reasoning effort, full-access
settings, emergency denies, hooks, or native registration. Select the model
and any available thinking control in the product itself. A prompt cannot
prove that a model, setting, local file, or tool changed.

## Check in a new chat

After saving, run these small checks in each product and mode you use:

1. Ask a short question in Thai. Expect a short Thai answer. Include an
   English quote or code sample and check that the reply stays in Thai.
2. Ask for English explicitly. Expect simple English. Ask for detail and check
   that the brevity preference does not block the requested explanation.
3. Provide a small code task. Check that comments are limited to real needs
   and that the answer does not add unrelated features.
4. Ask for a result from a file or command that is unavailable in that chat.
   Expect a clear access limit, not an invented read or passing test.

Record the date, product, selected model, mode, and actual result. Repository
text and link checks establish file validity only. Saving, inheritance, and
behavior in authenticated web chats are `NOT_RUN_UNAVAILABLE` until observed
in the owner's account. No web account settings are changed by a Git pull or
by the repository quality commands.
