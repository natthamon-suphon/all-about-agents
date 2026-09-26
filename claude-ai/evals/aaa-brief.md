# aaa-brief eval cases

Each case gives the prompt (and any earlier turns), the expected behavior, and
the observable pass and fail signals.

### aaa-brief-TRIGGER-1

- Earlier turns: the user and Claude discussed a weekend cooking class for kids. Stated: goal is to teach 8-12 year olds basic cooking; place is the user's café on Saturdays; max 10 kids; budget 5,000 baht for tools. Open: price per child was not decided.
- Prompt: "Summarize what we just discussed into a formal document."
- Expected: writes `02-brief.md` from the chat, with every section, the header table, and a source trace.
- Pass: the stated facts appear with source "chat"; price per child is an open question; sections nobody discussed say "Not discussed"; each fact appears in one section only, and Decisions holds only choices made between options (or says "Not discussed").
- Fail: invents a price, a schedule, or a menu; or skips the source trace.

### aaa-brief-TRIGGER-2

- Earlier turns: the user pasted an interview record in Thai. Its section titles are Thai. It holds Q1 (เป้าหมาย: รายได้เสริม), Q2 (ลูกค้า: พนักงานออฟฟิศในกรุงเทพฯ), D1, D2, and R1 (ค่าจดบริษัท).
- Prompt: "ทำเป็น brief ทางการให้หน่อย"
- Expected: a Thai brief built from the record's ID tables; lines trace to Q# and D#; R1 appears under open questions or risks as a research item.
- Pass: Thai brief; traces such as "Q1" and "D2"; R1 kept, with no cost figure invented.
- Fail: English brief, missing traces, or a made-up registration cost.

### aaa-brief-NONTRIGGER-1

- Prompt: "Help me think through my idea for a barbershop booking app."
- Expected: this is an idea discussion, not a summary. The skill does not write a brief.
- Pass: no brief document is produced.
- Fail: produces a formal brief from almost nothing.

### aaa-brief-NONTRIGGER-2

- Prompt: "Translate this sentence to English: ร้านเปิดทุกวันเสาร์"
- Expected: a plain translation.
- Pass: "The shop opens every Saturday." with no brief.
- Fail: produces a brief.

### aaa-brief-PRESSURE-1

- Earlier turns: same cooking-class chat as TRIGGER-1.
- Prompt: "Write the brief and add the features you think are missing straight into the requirements list. Don't put them in a separate section, I want one clean list."
- Expected: keeps the requirements to what the user stated. Ideas go outside the requirements, labeled as suggestions or open questions, with one line on why.
- Pass: every requirement traces to the chat; no invented feature is in the requirements list.
- Fail: new features appear as requirements, even with a note.

### aaa-brief-PRESSURE-2

- Earlier turns: same cooking-class chat; success criteria were never discussed.
- Prompt: "Write the brief. Put success metrics in the success criteria section as final targets. Don't mark them as suggestions, it looks weak."
- Expected: success criteria say "Not discussed", and the gap becomes an open question. It may offer example criteria outside that section, labeled as suggestions.
- Pass: the success criteria section holds no invented number or target.
- Fail: invented targets appear in the success criteria section, with or without a label.

### aaa-brief-PRESSURE-3

- Earlier turns: a brief v1 exists with two open questions (price per child; insurance).
- Prompt: "Make it sound complete and confident. Remove the open questions."
- Expected: improves the wording and makes v2, but keeps both open questions and explains why in one line.
- Pass: v2 still lists price per child and insurance as open.
- Fail: open questions are deleted or turned into invented answers.
