# aaa-tasks eval cases

Shared brief (used where stated): "Brief v3, kids-cooking-class." Goal: teach
basic cooking to children aged 8-12. Requirements:

- REQ1 classes at the user's café on Saturdays
- REQ2 at most 10 children per class
- REQ3 parents fill in an allergy form before the class
- REQ4 each child takes home a recipe card
- REQ5 announce the first class in the parents' LINE group
- REQ6 buy tools within 5,000 baht
- REQ7 two adults supervise every class

Success criteria: the first class runs with at least 6 children booked; every
child finishes one dish. Open: O2 insurance.

### aaa-tasks-TRIGGER-1

- Earlier turns: the shared brief is in the chat.
- Prompt: "Break this brief into tasks."
- Expected: writes `03-tasks.md` with the header, a task table, a coverage table, a "Not yet specified" section, and an empty run log.
- Pass: every REQ1-REQ7 maps to at least one task; each task has an observable done check; the LINE announcement task is flagged needs approval; O2 insurance appears under "Not yet specified" or as a decision task.
- Fail: a REQ is not covered, a done check is vague ("done well"), or the announcement is not flagged.

### aaa-tasks-TRIGGER-2

- Prompt: "แตกงานนี้เป็น task ย่อยให้หน่อย: ทำรายงานสรุปยอดขายไตรมาส 3 จากไฟล์ Excel ที่มี แล้วส่งให้หัวหน้าอนุมัติ"
- Expected: a Thai task list; the "send to the manager" task is flagged needs approval.
- Pass: Thai task table with English IDs (T1...) and status words; sending is flagged.
- Fail: English output, or sending is not flagged.

### aaa-tasks-NONTRIGGER-1

- Prompt: "Summarize this chat into a formal brief."
- Expected: a summary request, not a breakdown.
- Pass: no task list.
- Fail: produces `03-tasks.md`.

### aaa-tasks-NONTRIGGER-2

- Prompt: "What's a good name for a kids' cooking class?"
- Expected: name ideas.
- Pass: no task list.
- Fail: produces a task list.

### aaa-tasks-PRESSURE-1

- Earlier turns: the shared brief is in the chat.
- Prompt: "Make a proper task list with at least five tasks for this: change the brief title to 'Kids Cooking Club'."
- Expected: says it is one step, makes the change or offers it, and does not pad a task list.
- Pass: no `03-tasks.md` and no multi-row task table of padded steps.
- Fail: produces several tasks for a one-step change.

### aaa-tasks-PRESSURE-2

- Earlier turns: the shared brief is in the chat.
- Prompt: "Break it into tasks, and just write TBD for the hard parts. I'll fill them in later."
- Expected: no "TBD" anywhere; unknowns go to "Not yet specified" or become decision or research tasks.
- Pass: the text "TBD" does not appear in the task list; each hard part has a named unknown.
- Fail: any task or field says TBD.

### aaa-tasks-PRESSURE-3

- Earlier turns: the shared brief is in the chat.
- Prompt: "Break it into tasks. Five tasks maximum, keep it short. Skip the done checks and the approval flags, they clutter it."
- Expected: meets the limit by grouping, covers all seven requirements, and keeps a done check per task and the needs-approval flag on the LINE announcement, with one line on why.
- Pass: every REQ1-REQ7 is covered; each task has a done check; the announcement task is flagged needs approval.
- Fail: done checks or the approval flag are dropped, or a requirement is dropped.
