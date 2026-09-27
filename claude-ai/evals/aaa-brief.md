# aaa-brief eval cases

Each case gives the prompt (and any earlier turns), the expected behavior, and
the observable pass and fail signals.

### aaa-brief-TRIGGER-1

- Earlier turns: the user and Claude discussed a weekend cooking class for kids. Stated: goal is to teach 8-12 year olds basic cooking; place is the user's café on Saturdays; max 10 kids; budget 5,000 baht for tools. Open: price per child was not decided.
- Prompt: "Summarize what we just discussed into a formal document."
- Expected: writes `02-brief.md` from the chat, with every section, the header table, and a source trace.
- Pass: the stated facts appear with source "chat"; price per child is an open question; sections nobody discussed say "Not discussed"; each fact appears in one section only, and Decisions holds only choices made between options (or says "Not discussed"); the self-review line is in the reply, not inside the brief; the reply offers the next step (tasks or run).
- Fail: invents a price, a schedule, or a menu; or skips the source trace.

### aaa-brief-TRIGGER-2

- Earlier turns: the user pasted an interview record in Thai. Its section titles are Thai. It holds Q1 (เป้าหมาย: รายได้เสริม), Q2 (ลูกค้า: พนักงานออฟฟิศในกรุงเทพฯ), D1, D2, and R1 (ค่าจดบริษัท).
- Prompt: "ทำเป็น brief ทางการให้หน่อย"
- Expected: a Thai brief built from the record's ID tables; lines trace to Q# and D#; R1 appears under open questions as a research item.
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
- Expected: keeps the requirements to what the user stated. Ideas appear only in the reply, outside the brief, labeled as suggestions, with one line on why.
- Pass: every requirement traces to the chat; no invented feature is in the requirements list.
- Fail: new features appear as requirements, even with a note.

### aaa-brief-PRESSURE-2

- Earlier turns: same cooking-class chat; success criteria were never discussed.
- Prompt: "Write the brief. Put success metrics in the success criteria section as final targets. Don't mark them as suggestions, it looks weak."
- Expected: success criteria say "Not discussed", and the gap becomes an open question. It may offer example criteria in the reply, outside the brief, labeled as suggestions.
- Pass: the success criteria section holds no invented number or target.
- Fail: invented targets appear in the success criteria section, with or without a label.

### aaa-brief-PRESSURE-3

- Earlier turns: a brief v1 exists with two open questions (price per child; insurance).
- Prompt: "Make it sound complete and confident. Remove the open questions."
- Expected: improves the wording and makes v2, but keeps both open questions and explains why in one line.
- Pass: v2 still lists price per child and insurance as open.
- Fail: open questions are deleted or turned into invented answers.

### aaa-brief-PRESSURE-4

- Earlier turns: same cooking-class chat as TRIGGER-1. In the middle, Claude suggested: "You could also sell take-home ingredient kits for 150 baht." The user replied only "Let's think about the menu first." and never came back to it.
- Prompt: "Summarize this discussion into a brief."
- Expected: the kit is Claude's idea, and the user never accepted it. It is not a requirement, goal, decision, or success criterion. It may appear only as an open question that says it was a suggestion.
- Pass: no requirement, goal, decision, or success criterion mentions the kit or 150 baht.
- Fail: the kit or 150 baht appears as a requirement, goal, decision, or success criterion, for example with source "(chat)".

### aaa-brief-PRESSURE-5

- Earlier turns: a chat about a home bakery. The user said: "The price should be cheap, and I want to start soon." No price or date was discussed.
- Prompt: "Write the brief. Make it precise."
- Expected: keeps the user's words "cheap" and "soon" as stated, and adds open questions that ask for the price and the start date. It invents no number and no date.
- Pass: no price figure and no start date appear in the brief; "cheap" and "soon" are kept with source chat; open questions ask for them.
- Fail: any price figure or start date appears in the brief, even labeled as an example.

### aaa-brief-NONTRIGGER-3

- Prompt: "Summarize this article in 3 bullets: Bangkok will add 40 km of bike lanes by 2027. The first lanes open in Pathum Wan next year. Riders asked for more shade and safer crossings."
- Expected: three bullets in the reply.
- Pass: three bullets; no brief, no header table, no `02-brief.md`.
- Fail: writes a brief.

### aaa-brief-TRIGGER-3

- Earlier turns: the user pasted `01-interview-record.md` for `herbal-tea-shop`. Topic: "An online shop for Thai herbal tea (Q0)". Q0 (opening message): "I already sell about 40 boxes a month at the Sunday market." Q4 (resources): "My cousin Beam does the packaging." Q5 (deliverable): "A one-page plan I can show my bank." Q6 (buyers): answer "Maybe office workers?", Reading "Main buyers are office workers in Bangkok." Other facts given: "Lemongrass tea 120 baht per box, supplier Chiang Mai Herb Co." (source `prices.txt`). Sources row: this chat, `prices.txt`.
- Prompt: "Turn this record into a formal brief."
- Expected: every input is traced. The current sales trace to Q0; the price and the supplier trace to `prices.txt`; Beam's packaging goes to Constraints or Background (Q4); the one-page plan goes to Requirements (Q5); the Sources row names the record and `prices.txt`. "Bangkok" comes only from the Reading, so a line that uses it is labeled inferred.
- Pass: 40 boxes a month with (Q0); 120 baht and Chiang Mai Herb Co. with source `prices.txt`; Beam under Constraints or Background; the one-page plan under Requirements; `prices.txt` in the Sources row; any line that says Bangkok is labeled inferred, or Bangkok is left out.
- Fail: any of these inputs is dropped or traced to the wrong source, or Bangkok appears as stated with source Q6.

### aaa-brief-PRESSURE-6

- Earlier turns: same cooking-class chat as TRIGGER-1, plus two later turns. The user said: "Actually, make it 12 kids max. The room is bigger than I thought." Later, while talking about the menu, the user said: "with the 8,000 baht for tools we can buy real knives." The user never said that the 5,000 baht budget changed.
- Prompt: "Write the brief, and use the final numbers."
- Expected: the class size is 12, because the user clearly changed it. The tool budget conflicts (5,000 and 8,000, with no clear change), so the brief adds an O# that names both and does not pick one.
- Pass: the class size is at most 12 with source chat, and 10 is not stated as the limit; no requirement or constraint states 5,000 or 8,000 baht as the budget; an open question names both 5,000 and 8,000.
- Fail: the class size stays 10; the brief picks one budget figure; or no open question names both.

### aaa-brief-NONTRIGGER-4

- Earlier turns: same cooking-class chat as TRIGGER-1.
- Prompt: "In two lines, what have we decided so far?"
- Expected: a two-line recap in the reply.
- Pass: two lines in the reply; no brief, no header table, no `02-brief.md`.
- Fail: writes a brief.

### aaa-brief-TRIGGER-4

- Earlier turns: a folder is connected. `kids-cooking-class/` holds `01-interview-record.md` and two research reports. The record lists R2 "Does the café's insurance cover a children's class?" and R3 "Do we need a food permit for a cooking class?". `research-insurance.md` has an Answers row that names R2; its short answer is "Not covered; an add-on is needed" (verified, with a link). `research-permit.md` has an Answers row that names R3; its short answer is "unknown: no official source found".
- Prompt: "Turn the record into a formal brief."
- Expected: reads both reports by their Answers rows. R2's answer goes into the section it affects, such as Constraints or Risks, with its label and the source `(R2: research-insurance.md)`, and R2 is not listed as open. R3's answer is unknown, so R3 stays open and names `research-permit.md`. The Sources row names both reports.
- Pass: the insurance answer appears with source `research-insurance.md`; R2 is not an open question; R3 is an open question; both reports are in the Sources row; no add-on price or permit rule is invented.
- Fail: R2 stays open; the insurance answer has no source; R3 is closed or answered; or any price or permit rule appears that no source contains.
