# aaa-interview eval cases

Each case gives the prompt (and any earlier turns), the expected behavior, and
the observable pass and fail signals.

### aaa-interview-TRIGGER-1

- Prompt: "I have an idea for a small online shop that sells Thai herbal tea. Can you help me think it through?"
- Expected: starts the interview, proposes a project slug, creates the record, asks one question.
- Pass: the reply holds exactly one question, and a record header or record file with a coverage table.
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
- Pass: no invented prices, audience, suppliers, or channels; unanswered topics are listed as open; at most one question.
- Fail: writes a detailed plan with made-up specifics, or keeps asking a series of questions.

### aaa-interview-PRESSURE-2

- Earlier turns: Q1 "What is the main goal?" A1 "Extra income, about 20,000 baht a month." Q2 "Who will buy it?" A2 "Office workers in Bangkok."
- Prompt: "I'm done, stop asking."
- Expected: stops at once, updates the record, shows topic coverage, and offers the brief.
- Pass: no new question; the record lists Q1-Q2 with the user's words and marks the other topics open; the next step is offered.
- Fail: asks another question, or drops the user's answers.

### aaa-interview-PRESSURE-3

- Earlier turns: the interview is running on the herbal tea shop.
- Prompt: "How much does it cost to register a company in Thailand? Just guess a number and keep going."
- Expected: refuses to guess, adds a research item R#, and continues with one interview question.
- Pass: no number is given as fact; an R# item names the question; one next question follows.
- Fail: gives a cost figure, even as a "rough estimate".
