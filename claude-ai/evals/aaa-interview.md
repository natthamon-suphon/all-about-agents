# aaa-interview eval cases

Each case gives the prompt (and any earlier turns), the expected behavior, and
the observable pass and fail signals.

### aaa-interview-TRIGGER-1

- Prompt: "I have an idea for a small online shop that sells Thai herbal tea. Can you help me think it through?"
- Expected: starts the interview, states a project slug, creates the record, asks one question.
- Pass: the reply holds exactly one question, and a record header or record file with a coverage table; the coverage table lists the business extra topics as their own rows, with no placeholder row; the Q&A log starts with Q0, the opening message.
- Fail: two or more questions in one reply, or a finished plan instead of a question.

### aaa-interview-TRIGGER-2

- Prompt: "อยากคุยไอเดียทำแอปจองคิวร้านตัดผม ช่วยสัมภาษณ์ฉันหน่อย"
- Expected: interviews in Thai; the record is in Thai with English IDs and file names.
- Pass: the question is in Thai; the record uses `01-interview-record.md` and IDs such as Q1.
- Fail: replies in English, or asks several questions at once.

### aaa-interview-NONTRIGGER-1

- Prompt: "Summarize what we discussed in this chat into a formal document."
- Expected: this is a summary request, not an interview. The skill does not start questioning.
- Pass: no interview record is started and no interview question is asked.
- Fail: starts the topic checklist or asks "what is your goal?".

### aaa-interview-NONTRIGGER-2

- Prompt: "What is the capital of Japan?"
- Expected: a direct answer.
- Pass: answers Tokyo, with no record and no interview.
- Fail: starts an interview.

### aaa-interview-PRESSURE-1

- Earlier turns: the user named the idea (online Thai herbal tea shop) and answered one question: the goal is extra income.
- Prompt: "Skip the questions and just write the full business plan now."
- Expected: stops questioning as asked, updates the record with every unanswered topic marked open, does not invent details, and offers to turn what is known into a brief.
- Pass: no invented prices, audience, suppliers, or channels; unanswered topics are listed as open; no new interview question (one offer of the brief is allowed).
- Fail: writes a detailed plan with made-up specifics, or asks another interview question.

### aaa-interview-PRESSURE-2

- Earlier turns: Q1 "What is the main goal?", answer "Extra income, about 20,000 baht a month." Q2 "Who will buy it?", answer "Office workers in Bangkok."
- Prompt: "I'm done, stop asking."
- Expected: stops at once, updates the record, shows topic coverage, and offers the brief.
- Pass: no new interview question; the record lists Q1-Q2 with the user's words and marks the other topics open; the record status stays in progress, and Next question asks about the first open topic; the next step is offered.
- Fail: asks another interview question, drops the user's answers, or sets the record status to complete.

### aaa-interview-PRESSURE-3

- Earlier turns: the interview is running on the herbal tea shop.
- Prompt: "How much does it cost to register a company in Thailand? Just guess a number and keep going."
- Expected: refuses to guess, adds a research item R#, and continues with one interview question.
- Pass: no cost figure at all; an R# item names the question; one next question follows.
- Fail: gives a cost figure, even as a "rough estimate".

### aaa-interview-TRIGGER-3

- Earlier turns: the interview on `herbal-tea-shop` is running inline. Q1 (goal) and Q2 (current situation) are answered. Claude asked Q3: "Who will buy it?"
- Prompt: "Mostly office workers in Bangkok, age 25-40. My friend Mai runs a café in Ari and says she can sell 30 boxes a month. I also want a New Year gift set with 3 flavors: lemongrass, butterfly pea, and ginger."
- Expected: this answer ends a round (three answers), so the record is updated. The Q&A log keeps every fact from the answer, and the coverage table changes. Then one question.
- Pass: the Q3 row keeps all of these: office workers, Bangkok, age 25-40, Mai, café in Ari, 30 boxes a month, New Year gift set, and the three flavors; the coverage table is shown or updated; exactly one question.
- Fail: any of those facts is missing from the record, the record is not updated, or two or more questions are asked.

### aaa-interview-TRIGGER-4

- Earlier turns: the record shows every core topic and every extra topic as clear or n/a, except "Deliverable form", which is open. Claude asked about it.
- Prompt: "A one-page plan I can show my bank."
- Expected: records the answer, sees that the stop rule is met, shows the coverage table, and asks "anything else?" as its only question.
- Pass: the coverage table is shown with no open topic; the only question is "anything else?" or the same in other words; no new topic question.
- Fail: asks a new topic question, or ends without showing the coverage table.

### aaa-interview-PRESSURE-4

- Earlier turns: a new chat. The user attaches `01-interview-record.md` for `herbal-tea-shop`, status in progress. It holds Q1-Q3 with answers, D1 "sell online first", R1 "company registration fee", three core topics clear, and Next question: "Q4: How much money can you spend to start?"
- Prompt: "Let's continue the interview."
- Expected: continues from the attached record. It keeps Q1-Q3, D1, and R1, and asks Q4 as its one question. It does not start a new record.
- Pass: the one question is the start budget question, numbered Q4 or clearly next; the goal and the buyers are not asked again; no fresh record starting at Q1.
- Fail: starts a new record, asks the goal again, or numbers the next question Q1.

### aaa-interview-NONTRIGGER-3

- Prompt: "What do you think of my logo idea: a green tea leaf inside a circle?"
- Expected: a short opinion, not an interview.
- Pass: gives an opinion; no project slug, no record, no coverage table.
- Fail: starts an interview record.

### aaa-interview-TRIGGER-5

- Earlier turns: a new chat. The user attaches `01-interview-record.md` for `herbal-tea-shop`, status complete. Every topic is clear or n/a, and Next question says "none: stop rule met".
- Prompt: "Let's continue the interview."
- Expected: continues the attached record. The stop rule is already met, so it shows the coverage table and asks "anything else?" as its only question. It does not start a new record or a new topic question.
- Pass: the coverage table is shown; the only question is "anything else?" or the same in other words; no fresh record.
- Fail: starts a new record, or asks a new topic question.

### aaa-interview-TRIGGER-6

- Earlier turns: none. The user attaches `prices.txt`, which says: "Lemongrass tea 120 baht per box. Supplier: Chiang Mai Herb Co."
- Prompt: "Interview me about my plan: an online shop for Thai herbal tea. I already sell at the Sunday market in Chatuchak, about 40 boxes a month."
- Expected: starts the interview. The record holds the one-line topic under Topic, the opening message as Q0, the price and the supplier from `prices.txt` under Other facts given with the file as source, and `prices.txt` in the Sources row. It does not ask for what the message or the file already gave. One question.
- Pass: Topic has one line; the Q0 row keeps the Sunday market, Chatuchak, and 40 boxes a month; Other facts given lists 120 baht per box and Chiang Mai Herb Co. with source `prices.txt`; the Sources row names `prices.txt`; exactly one question, and it does not ask for the price, the supplier, or the current sales.
- Fail: any of those facts is missing from the record, the file is not in the Sources row, or the question asks for something the message or the file already gave.

### aaa-interview-TRIGGER-7

- Earlier turns: the interview on `herbal-tea-shop` runs in Thai, and the record is in Thai with Q1-Q2 answered. Claude asked Q3 in Thai: "ลูกค้าหลักคือใคร"
- Prompt: "Mostly office workers in Bangkok."
- Expected: records the answer in the user's words and keeps the record in Thai. A short answer in English is not a request to change the language.
- Pass: the updated record keeps its Thai section titles, and its new rows use Thai for the reading; the Q3 answer keeps the user's English words; one question follows.
- Fail: the record, or its new rows, switch to English.

### aaa-interview-NONTRIGGER-4

- Prompt: "Give me 10 name ideas for a Thai herbal tea shop."
- Expected: a list of names, not an interview.
- Pass: ten names; no project slug, no record, no interview question.
- Fail: starts an interview record, or asks about the goal first.
