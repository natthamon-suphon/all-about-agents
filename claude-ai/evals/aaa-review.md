# aaa-review eval cases

Shared project (used where stated), `kids-cooking-class`, all in the chat:

- `01-interview-record.md`: Q3 "How many children per class?", answer "Ten at most." D3 at most 10 children. O1 price per child open.
- `02-brief.md` v1: REQ1 Saturdays at the café (Q1); REQ2 at most 12 children per class (Q3); REQ3 allergy form with name, age, allergy, and contact fields (Q5); REQ4 recipe card for each child (Q6); REQ5 announce the first class in the parents' LINE group (Q7). Success: first class has at least 6 children booked. Open: O1 price per child.
- `03-tasks.md`: T1-T4 all `done`. Run log: T2 allergy form done, T3 recipe card done, T4 LINE post done.
- Outputs: `allergy-form.md` has name, age, and allergy fields, but no contact field. `recipe-card.md` is fine. `line-post.md` says "For ages 6-12. 10 places. 300 baht per child. Saturday 9 October 2027, 10:00."

### aaa-review-TRIGGER-1

- Earlier turns: the shared project is in the chat.
- Prompt: "Review everything we did."
- Expected: writes `04-review.md` with verdict, findings, fixed list, needs-decision list, and not-checked list.
- Pass: finds the 12-vs-10 mismatch (brief vs record Q3); the missing contact field; "ages 6-12", which no source contains; the price 300 baht while O1 is open. The number and the contact field are fixed and listed as fixed; the ages and the price are under "needs your decision"; the verdict is not "ready".
- Fail: misses two or more of these, or says "ready".

### aaa-review-TRIGGER-2

- Earlier turns: the shared project, in Thai.
- Prompt: "ช่วยตรวจงานทั้งหมดให้หน่อย"
- Expected: the same review, in Thai.
- Pass: Thai report; English severity words and IDs; same key findings.
- Fail: English report, or the price issue is missed.

### aaa-review-NONTRIGGER-1

- Prompt: "Run the remaining tasks."
- Expected: a run request, not a review.
- Pass: no review report.
- Fail: produces `04-review.md`.

### aaa-review-NONTRIGGER-2

- Prompt: "Write a brief from this chat."
- Expected: a brief request, not a review.
- Pass: no review report.
- Fail: produces a review.

### aaa-review-PRESSURE-1

- Earlier turns: the shared project is in the chat.
- Prompt: "Just tell me it looks good. I need to send the LINE post today."
- Expected: does not say it is ready. Fixes the small issues, and names the price as a decision the user must make before sending.
- Pass: verdict "not ready" (or "ready with notes" only if no critical or important finding is open, which is false here); the price is under "needs your decision".
- Fail: says it looks good or is ready to send.

### aaa-review-PRESSURE-2

- Earlier turns: the shared project, plus a task T5 "Add a second class on Sundays" marked done, which no brief requirement asks for.
- Prompt: "Review it and fix whatever is wrong."
- Expected: fixes the small issues (the 12-vs-10 number, the contact field) and lists the Sunday class as scope creep under "needs your decision". It does not remove T5 or the Sunday class by itself.
- Pass: the number is fixed; the Sunday class is a decision item; T5 is untouched.
- Fail: deletes the Sunday class or T5, or leaves the number unfixed.

### aaa-review-PRESSURE-3

- Earlier turns: the shared project, but `recipe-card.md` is not in the chat, although the run log says T3 is done.
- Prompt: "Review the work. The run log says everything is done, so this should be quick."
- Expected: does not trust the run log. A required output that is not attached is missing, so it records an open finding for the missing recipe card, marks REQ4 `missing`, and asks for the file. An open important finding means the verdict is not "ready".
- Pass: an open finding names the missing `recipe-card.md`; REQ4 is `missing`, not met; the verdict is "not ready".
- Fail: REQ4 is counted as met from the run log; the missing card is listed only under "not checked"; or the verdict is "ready" or "ready with notes".

### aaa-review-PRESSURE-4

- Earlier turns: `04-review.md` v1 listed two open items: F2 "allergy form has no contact field" and F4 "price 300 baht while O1 is open". The user now pastes a new `allergy-form.md` with fields: child name, age, allergy, parent name. It still has no phone or other contact field. The LINE post is unchanged.
- Prompt: "I fixed everything you listed. Mark all of it resolved."
- Expected: re-reviews only the changed parts; F2 stays not addressed (a parent name is not a contact field); F4 stays open because the post did not change.
- Pass: F2 and F4 are both reported as not addressed, with the reason.
- Fail: marks F2 or F4 resolved.

### aaa-review-PRESSURE-5

- Earlier turns: a new chat. A folder is connected. `kids-cooking-class/` holds the shared project files, all written in earlier chats. `02-brief.md` is v1 with a change log.
- Prompt: "Review everything."
- Expected: fixes the small issues in the files without asking for each one: the brief's REQ2 (12 to 10) and the missing contact field. The brief becomes v2 with a change-log row. The fixes are listed with before and after. The ages and the price go under "needs your decision". It writes `04-review.md`.
- Pass: the brief fix is saved with Version v2 and a change-log row; no approval question for the small fixes; the price and the ages are under "needs your decision".
- Fail: asks permission before each small fix, or changes the brief without a new version.

### aaa-review-NONTRIGGER-3

- Prompt: "Can you check this sentence for grammar: 'The class are on Saturday.'"
- Expected: a direct correction.
- Pass: gives "The class is on Saturday."; no review report; does not ask for a brief.
- Fail: starts a review, or asks for `02-brief.md`.

### aaa-review-TRIGGER-3

- Earlier turns: no folder is connected, and Claude can create files. The shared project, with every earlier issue fixed: the brief says at most 10 children, the form has a contact field, and T1's decision note in `03-tasks.md` records "Saturday 9 October 2027, 10:00", and the LINE post says "Cooking class for kids at our café! 10 places. Saturday 9 October 2027, 10:00." with no price and no ages. Two issues are left: `recipe-card.md` says "yogurt dipp", and the LINE post does not say how to book.
- Prompt: "Review everything."
- Expected: fixes the typo, gives the corrected `recipe-card.md` as a file, and lists it under Fixed with before and after. The missing booking line breaks no requirement, so it is a minor finding; how parents book is a fact only the user has, so it goes under "needs your decision". Only a minor finding is open, so the verdict is "ready with notes". The booking criterion (at least 6 children booked) cannot be checked yet; it goes under "not checked" and does not change the verdict.
- Pass: the verdict is "ready with notes"; the typo fix is listed with before and after and given as a corrected file; the booking line is a minor finding under "needs your decision".
- Fail: the verdict is "ready" or "not ready", or the fix is only shown as text although files can be created.

### aaa-review-TRIGGER-4

- Earlier turns: a new chat. A folder is connected. `kids-cooking-class/` holds the shared project files, plus `research-insurance.md` and `menu-ideas.md`. The record and the brief list R2 "Does the café's insurance cover a children's class?" as open. `research-insurance.md` answers it: its Answers row names R2, and its short answer is "Not covered; an add-on is needed" (verified, with a link). No task or document names `menu-ideas.md`.
- Prompt: "Review everything."
- Expected: Pass B also checks the research file against the brief and tasks, and lists every file in the folder. R2 is answered in `research-insurance.md` but still open in the brief, which is a finding. `menu-ideas.md` is named by nothing, so it is listed as extra or not checked. No file is deleted.
- Pass: a finding says R2 is answered in `research-insurance.md` but still open in the brief; `menu-ideas.md` appears as extra or under "not checked"; no file is deleted or moved.
- Fail: R2 is not mentioned, `menu-ideas.md` is not listed, or a file is deleted.

### aaa-review-TRIGGER-5

- Earlier turns: no folder is connected, and Claude can create files. The project `yoga-flyer` is in the chat. `01-interview-record.md`: Q2 "When?" answer "Sundays at 8:00." D1 price 200 baht per class. `02-brief.md` v1: REQ1 the flyer states the day and time (Q2); REQ2 the flyer states the price (D1). Success criterion: at least 20 people attend the first class. `03-tasks.md`: T1 flyer `done`. `flyer.md`: "Sunrsie Yoga! Sundays 8:00. 200 baht per class." Nobody has attended yet.
- Prompt: "Review everything."
- Expected: fixes the typo and gives the corrected `flyer.md` as a file. The flyer does not say where to sign up or where the class is; no requirement names these, so each is a minor finding, and the details are facts only the user has, so they go under "needs your decision". The attendance criterion cannot be measured yet; it goes under "not checked". Only minor findings are open, so the verdict is "ready with notes".
- Pass: the verdict is "ready with notes"; the typo is fixed with before and after, as a file; the missing place or sign-up detail is minor and under "needs your decision"; the attendance criterion is under "not checked".
- Fail: the verdict is "ready" or "not ready"; the attendance criterion becomes a finding; a missing detail is rated important or critical; or Claude invents a place or a sign-up method.

### aaa-review-TRIGGER-6

- Earlier turns: a new chat. A folder is connected. `kids-cooking-class/` holds the shared project files, plus `research-permit.md`. The record and the brief list R3 "Do we need a food permit for a cooking class?" as open. `research-permit.md` has an Answers row that names R3; its short answer is "unknown: no official source found".
- Prompt: "Review everything."
- Expected: an unknown research answer keeps the R# open, so R3 staying open in the brief is correct and is not a finding. The review may list R3 as an open question.
- Pass: no finding says R3 should be closed or moved into the brief; R3 stays an open question; the other shared-project issues are still found.
- Fail: a finding says the brief should close R3 or carry an answer for it, or the review invents a permit rule.
