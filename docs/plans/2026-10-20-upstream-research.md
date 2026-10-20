# Research: Superpowers และ Matt Pocock upstream refresh

Status: Research complete for the approved scope; implementation is tracked
in the [authorized plan](2026-10-20-upstream-refresh-plan.md).

| Field | Value |
| --- | --- |
| Project | All About Agents (`all-about-agents`) |
| Document | Research report |
| Version | v1 |
| Date | 2026-10-20 |
| Status | complete |
| Language | Thai; technical names in English |
| Sources | this chat; repository source; pinned primary upstream snapshots; official OpenAI documentation |
| Answers | none |

## 1. คำถามและขอบเขต

ควรนำอะไรจาก `obra/superpowers` และ `mattpocock/skills` ล่าสุดมาปรับ AAA
ให้ทำงานได้ดีขึ้น โดยคง `core/`, `adapters/`, `installers/`, Claude Code,
Codex, Antigravity และ Windows/macOS?

**stated:** ผู้ใช้เลือกคงโครงสร้างเดิมและผสาน upstream ที่พร้อมใช้
ผู้ใช้อนุญาตให้เปลี่ยน workflow เมื่อทางใหม่ดีกว่า ไม่ได้ขอสำเนาทุกไฟล์
และไม่ได้อนุญาต commit, push, installation หรือ live configuration ในงานนี้

การตรวจครอบคลุม version, release notes, skill inventory, workflow ที่เปลี่ยน,
ไฟล์ประกอบ, ขอบเขต platform และหลักฐานทดสอบ ความพร้อมใช้ของ native product
ต้องตรวจต่างหาก การอ่าน source ไม่พิสูจน์ผลของ model

## 2. คำตอบสั้น

- **verified:** Superpowers `main` ตรงกับ `v7.0.0` ที่ commit `bb92a77741419a4ab5f06e711a283343f1ada0c3` วันที่ 2026-10-09 [S1]
- **verified:** Matt ประกาศ `1.3.1`; `main` คือ `5beb35b040e3de97e54fa9e386d7e42d15c295c2` วันที่ 2026-10-19 ซึ่งใหม่กว่า release tag [S2]
- **verified:** AAA มี 27 skills และมีระบบ validation, rendering, installation และ safety ของตนเอง [L1]
- **inferred:** ควรอัปเดต workflow ที่เปลี่ยนจริง เพิ่มความสามารถที่ขาด และบันทึก intentional divergence แทนการ merge ต้นฉบับทั้ง repo
- **unknown:** ยังไม่มีผลเปรียบเทียบ model ที่พิสูจน์ว่าแพ็กเกจหลังแก้ฉลาดขึ้น และยังไม่มี native verification ของแพ็กเกจใหม่

## 3. Findings

### 3.1 ฐานอ้างอิงล่าสุดที่ตรวจได้

| Repository | Version / revision | ความหมาย |
| --- | --- | --- |
| AAA | `2.3.0`, `7d2e6b892fd06630703589acfff9998091d2ba2c` | branch `main`; working tree มีงาน web instructions เดิม [L1] |
| Superpowers | `v7.0.0`, `bb92a77741419a4ab5f06e711a283343f1ada0c3` | release tag และ main ตรงกัน [S1] |
| Matt release | `v1.3.1`, commit `24fe0ef7737efae15c87225755e9f6f5965e4888` | annotated tag object คือ `0b6cee10f260a2e048279cf737bfd3e37b1fce0b`; ต้องแยก tag object จาก commit [S2] |
| Matt main | `5beb35b040e3de97e54fa9e386d7e42d15c295c2` | manifest ยังเป็น `1.3.1` แต่มีการแก้หลัง release จึงต้อง pin SHA ด้วย [S2] |

**verified:** Superpowers มี 15 skills ส่วน Matt มี 38 `SKILL.md` ใน source
แต่ plugin manifest เลือกเพียง 27 skills จาก engineering/productivity
อีก 11 อยู่ใน `in-progress` และ `misc` การอยู่บน main จึงไม่เท่ากับพร้อมส่ง
ทั้งหมด [S1] [S2]

**verified:** เทียบ Superpowers `v6.3.0..v7.0.0` พบ 47 paths ที่เปลี่ยนใน
`skills/` และ `hooks/` เทียบ Matt `v1.2.3..main` พบ 74 paths ที่เปลี่ยนใน
`skills/`, invocation guide และ plugin manifest ตัวเลขนี้นับไฟล์ ไม่ใช่ bugs
หรือจำนวนความสามารถที่ AAA ขาด [S1] [S2]

### 3.2 Superpowers: การเปลี่ยนที่มีผลต่อพฤติกรรม

| เรื่อง | สิ่งที่ upstream เปลี่ยน | ข้อเสนอสำหรับ AAA |
| --- | --- | --- |
| Brainstorming | เริ่มจากสิ่งที่ผู้ใช้ต้องการและเหตุผล; ทวนความเข้าใจ; เลือกขนาดงานหลังเข้าใจ; quick task ทำได้ทันที; small change ตกลงในแชต; project มี written design [S3] | รับหลัก intent-first และ proportional process; ไม่สร้าง interview หรือเอกสารให้ทุกงาน |
| Builder check | เปลี่ยนจากตรวจถ้อยคำ spec เป็นให้ผู้ที่จะสร้างงานถามเฉพาะจุดที่ยังต้องเดา [S3] | เปลี่ยน reviewer companion และทดสอบว่าไม่ถามเรื่องที่ตัดสินใจได้เอง |
| Writing plans | แผนบันทึก decisions, signatures, exact values และ assertions; ไม่เขียนโปรแกรมทั้งชุดระหว่างวางแผน; มี `Review Focus` และ `Global Constraints` [S4] | รับทั้งหมด พร้อม preserve exact authority และ approved-plan boundary ของ AAA |
| Inline execution | รันแผนต่อเนื่อง; ใช้ ledger; `task-start`/`task-done`; review อิสระครั้งท้าย; ไม่หยุดถามทุกไม่กี่ task [S5] | เพิ่มโหมดนี้ให้ครบโดย reuse Node helpers ที่มีอยู่; ไม่คัดลอก Bash-only implementation |
| SDD | มี rulings ต่อข้อขัดแย้ง, review package guards, task-scoped briefs และ fix-loop rules [S5] | ผสานเฉพาะสิ่งที่ AAA ยังขาด; เก็บ one writer at a time ใน shared checkout |
| Review | spec ไม่ได้แจกแจงทุก input; ต้องตรวจสิ่งที่ผู้ใช้สมเหตุผลคาดหวัง; มี `Declined to judge` [S6] | เพิ่มให้ reviewer และให้ coordinator ตัดสินรายการที่ถูกกันออก |
| TDD | focused test ผ่านยังไม่เท่ากับ suite ผ่าน; รายงานทุก failure ที่พบ [S6] | ระบุ focused-first และ relevant project suite ก่อนสรุป; รายงาน failure เดิมโดยไม่ขยายไปแก้ทุกเรื่อง |
| Session diagnosis | มี `diagnosing-superpowers`, path:line evidence, bounded transcript reading, redaction และ export gates [S7] | เพิ่ม workflow ที่เหมาะกับ AAA; ขอบเขตเป็น session ที่ระบุ; ไม่มีการ scan ทุกประวัติหรือ upload อัตโนมัติ |
| Windows hooks | แก้ Git Bash discovery, WSL launcher, PATH และ exit status [S1] | AAA ใช้ Node hook boundary อยู่แล้ว; เทียบผลลัพธ์ที่ต้องคง ไม่ย้ายกลับไปใช้ launcher ต้นฉบับ |
| Antigravity | เพิ่ม native manifest และแยกจาก Claude hooks [S1] | AAA มี adapter ของตนเอง; อย่าสับเปลี่ยน schema จาก source ที่ตรวจคนละ product version |

**verified:** AAA แก้ literal HTML replacement แล้วด้วย replacement function
และสร้าง workspace `.gitignore` แบบ create-only แล้ว จึงไม่ต้องนำ fix สองจุดนี้
มาทับซ้ำ [L2]

**inferred:** ไม่ควรนำทุกกฎของ SDD ต้นฉบับมาทั้งชุด เช่น การเลือก model ราคาถูก,
automatic commits หรือ cleanup workspace เพราะมีข้อกำหนดของผู้ใช้และ AAA
ที่เฉพาะกว่า [L3] [S5]

### 3.3 Matt: สิ่งเสริมที่มีคุณค่า

| เรื่อง | หลักฐาน upstream | ข้อเสนอสำหรับ AAA |
| --- | --- | --- |
| Domain model | `GLOSSARY.md`, `GLOSSARY-MAP.md`, ADR; สร้างเมื่อมี term/decision จริง; glossary ไม่เก็บ implementation [M1] | เพิ่ม `domain-modeling`; ให้ design, debugging, tests และ review ใช้ศัพท์เดียวกัน |
| Deep modules | depth เป็น leverage ที่ interface; deletion test; internal seams ต่างจาก public interface [M2] | refresh `codebase-design` และ references; ไม่สร้าง abstraction เพียงเพราะมี code หลายบรรทัด |
| Review สองแกน | Standards และ Spec แยก verdict; อ่าน `CONTRIBUTING.md`/standards จริง; smell เป็น heuristic และ project rule มาก่อน [M3] | รวมเข้ากับ requesting-code-review เดิม; ไม่สร้าง `code-review` ซ้ำอีกตัว |
| Good tests | tests ที่ public seams; หลีกเลี่ยง implementation coupling, tautological assertions และ bulk imaginary tests [M4] | รวมใน `test-driven-development`/`writing-good-tests.md`; คงข้อยกเว้นเล็กน้อยที่ AAA มีเหตุผลรองรับ |
| PR body | Summary, before/after Evidence และ Merge Danger; มี attribution ถึง Dex Horthy [M5] | เพิ่ม `pr` สำหรับร่างเนื้อหา; การสร้างหรือส่ง PR ยังต้องมีอำนาจแยก |
| Retro | เสนอปรับ environment; mechanical mistakes แก้ด้วย deterministic checks ก่อนเพิ่ม prose rules [M6] | เพิ่ม `retro` แบบผู้ใช้ร้องขอ; ไม่แก้ global config หรือส่งข้อมูลออกเอง |
| Invocation | แยก model-invoked กับ user-invoked; Claude frontmatter และ Codex `agents/openai.yaml` ต้องตรงกัน [M7] | บันทึกข้อแตกต่างอย่างตั้งใจ; ไม่แปล natural-language opt-in เป็น native opt-in โดยไม่ตรวจ semantics |
| Session phases | ใช้ context เดิมก่อน; handoff เมื่อมีสิ่งต้องย้าย; compaction สรุปข้อมูลและสูญเสียรายละเอียดได้ [M8] | ปรับ handoff/compaction ให้เน้น filesystem evidence และไม่ clear/compact อัตโนมัติ |
| Ticket graph | `implement-spec` ใช้ frontier, isolated worktrees และ integration branch [M9] | รับ dependency-graph reasoning ในแผน; ไม่เพิ่ม tracker subsystem หรือ merge automation ที่ซ้ำกับ AAA |

**verified:** เอกสาร OpenAI ระบุว่า `allow_implicit_invocation: false`
ปิด implicit selection แต่ explicit `$skill` ยังใช้ได้ การมี metadata นี้จึง
ไม่ได้พิสูจน์ว่า plain-language request จะเรียก skill แบบเดิมได้ [O1]

**verified:** Matt ถอด `resolving-merge-conflicts` ออกจากแพ็กเกจแล้ว
แต่ AAA มี skill ที่เป็นสัญญาความปลอดภัยของตนเอง การถอดจาก Matt อย่างเดียว
ไม่พิสูจน์ว่า skill ของ AAA ต้องลบด้วย [S2] [L1]

### 3.4 Disposition สำหรับ 27 skills เดิม

ตารางนี้เป็น **inferred proposal** จาก source ที่ตรวจ ไม่ใช่สถานะว่าแก้เสร็จแล้ว
`refresh` หมายถึงต้องตรวจ body, companions, routing cases และ tests ร่วมกัน

| Skill | ข้อเสนอ | เหตุผล / source |
| --- | --- | --- |
| brainstorming | refresh | intent-first, proportional work, builder check [S3] |
| codebase-design | refresh | vocabulary และ glossary references [M1] [M2] |
| dispatching-parallel-agents | retain + audit | native capability, disjoint ownership และ immutable review evidence [L1] |
| executing-plans | refresh | continuous inline execution, ledger และ final independent review [S5] |
| finishing-a-development-branch | retain + integrate | ใช้ `pr` เมื่อเขียน body; preserve exact Git authority [L3] [M5] |
| handoff | refresh narrowly | portable state, phase boundary และไม่ย้าย session เอง [M8] |
| improve-codebase-architecture | refresh narrowly | glossary และ ADR; คง Markdown-first/offline result ของ AAA [M1] [M2] |
| interviewing | refresh | ค้น facts เอง, intent-first, material questions เท่านั้น [S3] |
| loop-me | retain | เป็น AAA workflow ที่มี tests แล้ว แม้ upstream จัดไว้ใน in-progress [L1] [S2] |
| performance-profiling-and-benchmarking | retain | ไม่พบ upstream replacement ที่ทำให้ local performance contract หมดความจำเป็น [L1] |
| receiving-code-review | retain + audit | technical verification ก่อนแก้ และ scope authority [L1] |
| requesting-code-review | refresh | Standards/Spec verdicts, realistic inputs, declined judgments [S6] [M3] |
| research | retain | primary sources, explicit uncertainty และไม่บังคับ subagent [L1] |
| resolving-merge-conflicts | retain as divergence | local conflict safety มีประโยชน์; upstream deletion ไม่ใช่ local redundancy proof [L1] [S2] |
| session-compaction-resilience | refresh narrowly | phase boundary, source vs summary, resume evidence [M8] |
| subagent-driven-development | refresh narrowly | rulings, package guards, bounded fixes; preserve inherited context/native limits [S5] |
| systematic-debugging | refresh narrowly | authentic repro/mutation proof, public seam และ original scenario retest [M4] |
| test-driven-development | refresh | full relevant suite, no tautological assertions, glossary vocabulary [S6] [M4] |
| threat-modeling-and-security | retain | รองรับ trust boundary ที่เพิ่มจาก transcript diagnosis [L1] |
| using-all-about-agents | refresh narrowly | routing ใหม่และ explicit opt-in boundaries; ไม่คัดลอก native tool names เข้า core [L1] |
| using-git-worktrees | retain + audit | isolation เป็นทางเลือกตามงาน; ห้าม automatic discard/install/commit [L3] |
| verification-before-completion | refresh narrowly | แยก lint, real model behavior และ native lifecycle; รายงาน failure ทั้งหมด [L1] |
| wait-what | retain | concise re-pitch และ explicit confusion signal; ไม่เพิ่ม workflow ซ้ำ [L1] |
| wayfinder | refresh narrowly | decision frontier, local-first map, clear destination [M9] |
| writing-plans | refresh | decision-rich steps, Review Focus, proportion, no implementation while planning [S4] |
| writing-skills | refresh | interpreter-based scripts, runnable behavior proof และ dependency hygiene [S6] [M7] |
| zero-downtime-migrations | retain | compatibility, expand/contract และ rollback contract ของ AAA [L1] |

`using-superpowers` ของต้นฉบับ map มาที่ `using-all-about-agents` ของ AAA
ไม่ควรส่ง bootstrap สองตัวที่แข่งขันกัน ส่วน `diagnosing-superpowers` map เป็น
proposed `diagnosing-agent-workflows` ที่ต้องปรับ native discovery และ privacy
ก่อนใช้งาน [S7] [L1]

### 3.5 Matt skills ทั้งชุด: รวมที่ใด และอะไรไม่ควรเพิ่มซ้ำ

| Source skills | ข้อเสนอ |
| --- | --- |
| `domain-modeling`, `pr`, `retro` | เพิ่มเป็น skill ใหม่ โดย port contract ให้ vendor-neutral |
| `codebase-design`, `improve-codebase-architecture`, `research`, `handoff`, `wait-what`, `wayfinder` | refresh skill ชื่อเดียวกันของ AAA |
| `tdd`, `diagnosing-bugs`, `code-review`, `writing-for-agents` | รวมใน TDD, debugging, requesting review และ writing-skills ที่ AAA มีอยู่แล้ว |
| `grilling`, `grill-with-docs`, `grill-me` | รวม intent และ fact-finding ใน brainstorming/interviewing; ไม่เพิ่มสาม entry points ที่ชนกัน |
| `to-spec`, `to-tickets`, `implement`, `implement-spec` | รับ spec/decision graph/vertical slices ใน planning และ execution; ไม่เพิ่ม parallel execution framework อีกชุด |
| `ask-matt`, `setup-matt-pocock-skills`, `triage` | ไม่เพิ่ม router/tracker setup ที่ซ้ำหรือสร้าง external writes เป็น default; ให้ upstream provenance ระบุเหตุผล |
| `prototype` | รับแนวคิด throwaway question ใน brainstorming; UI-specific workflow ใช้ companion tools ที่ผู้ใช้เลือก |
| `wizard` | ไม่เพิ่ม Bash-only dashboard/credential wizard ใน portable baseline |
| `teach`, `to-questionnaire` | ไม่เพิ่มใน coding workflow baseline; เป็นความสามารถคนละขอบเขต |
| `in-progress/loop-me` | มี AAA adaptation แล้ว; คง local tests และบันทึก maturity ของ source |
| `in-progress/chief-of-staff`, `claude-handoff`, `setup-ts-deep-modules`, `writing-beats`, `writing-fragments`, `writing-shape` | ไม่ส่งเพิ่มเป็น stable skills; ไม่เหมารวม main ว่าพร้อมใช้ |
| `misc/git-guardrails-claude-code`, `migrate-to-shoehorn`, `scaffold-exercises`, `setup-pre-commit` | ไม่เพิ่ม platform/language-specific automation เป็น default global workflow |

### 3.6 สถาปัตยกรรมที่ต้องรักษา

**verified:** canonical skills และ companions มาจาก `core/inventory.json`;
adapters render source เป็น native package; canonical metadata schema ปฏิเสธ
undeclared properties และ native tool names การ copy frontmatter ของ Matt
เข้ามาโดยตรงจึงไม่ใช่ integration ที่ถูกต้อง [L1]

**verified:** ปัจจุบัน renderer ทั้งสามส่งออก frontmatter หลักเป็น `name`
และ `description`; global instructions ให้ project/plugin เป็นชั้นเฉพาะกว่า
และมีข้อกำหนดภาษา, comments, Karpathy, authority และ emergency protection
ที่ต้องรักษา [L3]

**verified:** `writing-good-tests.md` ของ AAA มี independent expectations,
tautological-test guard และ public-seam guidance อยู่แล้ว ส่วนที่ต้อง refresh
คือการเชื่อม suite evidence, authentic mutation และ routing/review contract
ไม่ใช่เขียน reference นี้ใหม่ทั้งไฟล์ [L5]

**inferred:** ใช้ Node standard library และ helpers เดิมสำหรับ execution
จะลด dependency บน Bash และลด state implementation ซ้ำระหว่าง SDD กับ inline
แต่ต้องมี tests สำหรับ process exit, silent output, path containment,
symlink/hardlink rejection และ uncommitted review snapshots

### 3.7 หลักฐานทดสอบและข้อจำกัด

| Check | ผลที่สังเกตได้ |
| --- | --- |
| `npm run sync:status` | exit 1 ตาม contract ของ dirty tree; local refs up-to-date; ahead/behind 0/0; ไม่ได้ยืนยัน remote freshness |
| `npm run quality:quick` | exit 0, `Quality: PASS`, Windows `win32`, Node `v24.4.0`; เป็น baseline ก่อน implementation |
| Upstream source code | cloned for reading only; ไม่ได้ execute downloaded upstream scripts |
| Model behavior comparison | not run; static text assertions ไม่ใช่ behavioral evidence |
| macOS / native CLI / Desktop / IDE ของแพ็กเกจใหม่ | `NOT_RUN_UNAVAILABLE`; ยังไม่มีแพ็กเกจหลังแก้ให้ตรวจ |

**verified:** manual model suite ปัจจุบันเลือกห้า skills และใช้ routing trailer
เป็นส่วนหนึ่งของ scoring จึงไม่พิสูจน์การเรียกทุก skill หรือการปฏิบัติตาม
workflow ทั้งหมด ต้องขยาย cases และแยก route claim จาก observed behavior [L4]

## 4. Conflicts และการตัดสินใจที่เสนอ

| ประเด็น | Upstream | AAA / user | ข้อเสนอและเหตุผล |
| --- | --- | --- | --- |
| Architecture | thin native integrations | canonical portable core และ managed installer | คงโครงสร้างตามที่ผู้ใช้เลือก; รับ workflow ผ่าน adapter seam |
| Permission | upstream บาง workflow commit/merge/cleanup เอง | exact action authority | คง user boundary; รับ continuous execution ภายใน approved scope |
| Model selection | เลือกตาม complexity/cost | current user-selected policy / highest supported effort | ไม่เปลี่ยน policy เพราะการอัปเดต workflow |
| Interview | Superpowers เริ่ม open question; Matt ถาม frontier เป็นชุด | ตอบสั้น; ถามเมื่อ material | intent-first; grouping เฉพาะคำถามอิสระ; ไม่ถาม facts ที่ตรวจได้เอง |
| Invocation | Matt แยก model-invoked กับ native user-invoked ตามแต่ละ skill | AAA ตั้งใจให้เลือกจากคำขอธรรมชาติ | คง discovery semantics และบันทึก divergence; native policy/UI metadata ไม่อยู่ใน scope รอบนี้ |
| TDD cycle | Matt เลื่อน refactoring ไป review; Superpowers ใช้ RED/GREEN/REFACTOR | AAA มี verified small refactor หลัง GREEN | คง RED/GREEN/REFACTOR; รับ anti-pattern guidance แทนการเปลี่ยนศาสนา TDD |
| Diagnostics | upstream dispatch ทุก dimension และมี bundle flow | scoped work และ privacy | วิเคราะห์เฉพาะคำถามที่ร้องขอ; bounded local evidence; export ต้องขอแยก |
| Visuals | upstream บาง skill ใช้ remote assets/CDN | AAA CSP/local-first | คง local-first assets และ no telemetry |
| Conflict skill | Matt ลบแล้ว | AAA มี independent safety contract | คงไว้พร้อมบันทึก deliberate divergence |

ทุกแถวเป็น **inferred recommendation**; ไม่อ้างว่า upstream ผิด และไม่ถือว่า
native support ของ product หนึ่งพิสูจน์อีก product หนึ่ง

## 5. Gaps

| สิ่งที่ยังไม่ยืนยัน | เหตุผล | ขั้นตอนยืนยัน |
| --- | --- | --- |
| ผลจริงของ workflow หลังปรับ | ยังไม่ implement | ทำ focused model cases เทียบ baseline และบันทึก transcript evidence |
| ทุก native surface บน Windows/macOS | host นี้เป็น Windows และ product session ไม่ได้เปิดทดสอบ | portable checks ก่อน; native checks ต่อ product/host ภายใต้อำนาจแยก |
| แหล่ง transcript ของทุก tool | source ต้นฉบับไม่ครอบคลุม native configuration ทั้งหมดของ AAA | ใช้ verified user-supplied file หรือ documented adapter discovery; ห้ามเดา paths |
| สิ่งใหม่หลัง pinned SHA | upstream เปลี่ยนต่อได้ | ตรวจ heads/tags อีกครั้งก่อนปิดงานและบันทึกสิ่งที่เปลี่ยน |
| กำไรด้าน accuracy/cost | ไม่มี controlled model comparison | อย่าระบุเปอร์เซ็นต์หรือรับประกันว่าไม่มีข้อผิดพลาด |

## 6. Sources

ทุกแหล่งด้านล่างเป็น primary source อ่านเมื่อ 2026-10-20
GitHub links pin commit เพื่อให้ตรวจซ้ำได้ ส่วน official documentation เป็น
ข้อมูลที่อ่าน ณ วันตรวจ ไม่ใช่หลักฐานว่า installed client ยอมรับแล้ว

[S1]: https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/RELEASE-NOTES.md
[S2]: https://github.com/mattpocock/skills/tree/5beb35b040e3de97e54fa9e386d7e42d15c295c2
[S3]: https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/brainstorming/SKILL.md
[S4]: https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/writing-plans/SKILL.md
[S5]: https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/executing-plans/SKILL.md
[S6]: https://github.com/obra/superpowers/compare/v6.3.0...v7.0.0
[S7]: https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/diagnosing-superpowers/SKILL.md
[M1]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/domain-modeling/SKILL.md
[M2]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/codebase-design/SKILL.md
[M3]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/code-review/SKILL.md
[M4]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/tdd/SKILL.md
[M5]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/pr/SKILL.md
[M6]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/retro/SKILL.md
[M7]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/.agents/invocation.md
[M8]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/ask-matt/PHASE-BOUNDARIES.md
[M9]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/implement-spec/SKILL.md
[O1]: https://learn.chatgpt.com/docs/build-skills
[L1]: ../../core/inventory.json
[L2]: ../../core/skills/brainstorming/scripts/server.cjs
[L3]: ../../core/instructions/global-operating-rules.md
[L4]: ../../tests/model/suite.json
[L5]: ../../core/skills/test-driven-development/writing-good-tests.md

Local companion evidence: [workspace helper](../../core/skills/subagent-driven-development/scripts/sdd-workspace.cjs),
[skill schema](../../core/schemas/skill.schema.json),
[core loader](../../installers/lib/load-core.mjs),
[Claude renderer](../../adapters/claude/adapter.mjs),
[Codex renderer](../../adapters/codex/adapter.mjs),
[Antigravity renderer](../../adapters/antigravity/adapter.mjs),
[manual model runner](../../tests/model/run-trigger-suite.mjs),
[earlier comparison](2026-09-18-repo-comparison.md)

## 7. Method

- อ่าน repo entry points, contributing/quality guides, inventory, current workflows,
  adapters ที่เกี่ยวข้อง, schema, helper contracts และ manual model runner
- resolve upstream heads ด้วย `git ls-remote`; clone snapshots ใน OS temp directory
  แยกจาก working repository; ไม่เปลี่ยน remote หรือ merge upstream ใน repo งาน
- ตรวจ manifest, release notes, skill catalogs และ diff จาก Superpowers `v6.3.0`
  และ Matt `v1.2.3`; แยก Matt release tag ออกจาก main ด้วย `git rev-parse v1.3.1^{}`
- อ่าน body ของ workflow หลักและ companions ที่เป็น load-bearing evidence;
  catalog/disposition ของ skills อื่นไม่ได้หมายถึงรัน behavior tests ของทั้งหมด
- ค้น official OpenAI docs ด้วย `Codex skills allow_implicit_invocation openai.yaml`
  แล้วเปิดและอ่านข้อกำหนดจริง ไม่ใช้ search snippet เป็นหลักฐาน
- ใช้ภาษา English ใน query ของ technical sources; รายงานเป็นภาษาไทย
- ตรวจ local baseline ด้วย `npm run sync:status` และ `npm run quality:quick`
