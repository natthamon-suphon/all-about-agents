# Upstream Refresh Design

Status: Approved by the human on 2026-10-20. The human explicitly delegated
plan writing and execution without another plan-approval question.

Date: 2026-10-20

## Purpose and decisions

ปรับ AAA ให้รับ workflow ล่าสุดที่พร้อมใช้จาก Superpowers และ Matt Pocock
โดยไม่สร้าง workflow framework สองชุดที่แข่งขันกัน ผู้ใช้เลือกคง `core/`,
`adapters/`, `installers/` และอนุญาตให้เปลี่ยน เพิ่ม หรือลบทุกส่วนใน repo
เมื่อมีเหตุผลว่าผลลัพธ์ดีขึ้น

ฐานอ้างอิงและข้อเท็จจริงอยู่ใน [research report](2026-10-20-upstream-research.md)
ข้อกำหนดด้านล่างเป็น proposed design ไม่ใช่รายงานว่า implementation เสร็จแล้ว

### Alternatives

1. คง canonical architecture และผสาน workflow ผ่าน native adapters
   รับประโยชน์จาก upstream พร้อมรักษา managed installation, safety และทุก tool
   ข้อแลกเปลี่ยนคือยังต้องดูแล adaptation และตรวจ drift เอง
2. เปลี่ยนกลับไปใกล้ upstream ทั้ง repo และแยก extensions
   ลด textual drift แต่ต้องสร้าง integration ของ AAA ใหม่และเสี่ยงสูญเสีย
   root containment, native ownership และ cross-tool contracts ที่มีอยู่

เลือกข้อ 1 ตามคำตอบผู้ใช้ ไม่ใช้จำนวนบรรทัดหรือจำนวน skills เป็นตัววัดความฉลาด

## Goals

- G1: ใช้ latest ready workflow จาก pinned upstream commits และระบุที่มาได้
- G2: ใช้กระบวนการตามขนาดงาน; ลดคำถามและเอกสารที่ไม่มีผลต่อ outcome
- G3: ให้แผน, execution, review, verification และ recovery ต่อกันครบ
- G4: เติม domain language, PR writing, retrospective และ session diagnosis
- G5: รักษา portable behavior บน Windows/macOS และ native adapters ทั้งสาม
- G6: พิสูจน์ mechanical contracts แยกจาก real model/native behavior

## Invariants and non-goals

- canonical content อยู่ใน `core/`; ไม่แก้ generated snapshots เป็น source
- ทุก surface รับ portfolio เดียวกัน; หลังเพิ่มสี่ skills คาดว่าเป็น 31
- ไม่มี dependency ใหม่ถ้า Node standard library และ helper เดิมทำงานได้
- ไม่เปลี่ยน user-selected model policy, effort, full-access mode หรือ emergency denies
- คง session language; default English A1-A2 เมื่อไม่มีภาษาที่ชัด; ตอบสั้น;
  ใช้ code comments เท่าที่จำเป็น; คง Karpathy integration และ companion tooling
- รักษางานเดิมใน README, global-instruction guide, documentation test,
  `docs/instructions/`, `docs/setup/web-instructions.md` และ `.agents/rules/`
- ไม่รวม `in-progress`/`misc` ทุก skill เพียงเพราะอยู่ใน upstream main
- ไม่เพิ่ม issue tracker subsystem, second executor, background updater หรือ telemetry
- ไม่ commit, push, merge, rewrite history, install, register หรือแก้ live config
  จากการอนุมัติงาน repository นี้
- `claude-ai/` เป็น pack แยก; web instructions เป็นข้อความสำหรับ paste;
  ทั้งคู่ไม่กลายเป็น native plugin โดยอัตโนมัติ

## Architecture and data flow

คง flow เดิม: canonical source และ inventory ผ่าน validation ไปยัง adapter
แล้วได้ deterministic package และ ownership manifest ก่อน dry-run/apply
การติดตั้งและ native registration เป็นการกระทำแยก

เพิ่ม provenance record ใน canonical source สำหรับสอง upstream และ disposition
ของแต่ละ canonical skill โดยมี repository URL, version/tag, resolved commit,
review date, source paths, adaptation notes และ local-only disposition
record นี้ต้องไม่อ้างว่า AAA เป็น upstream version เดียวกัน

ไม่มี network access ใน load/render/install เพื่ออัปเดต content เอง
คู่มือ sync แสดงวิธีตรวจ heads/tags และเทียบ pinned sources ใน checkout แยก
การพบ upstream ใหม่ไม่อนุญาตให้แก้ live configuration หรือ merge อัตโนมัติ

## Workflow contract

### 1. Routing and discovery

bootstrap ตรวจ trigger ก่อนเลือก workflow รวมทั้งคำขอ plain language
ไม่ทำให้ read-only answer หรือ status request ผ่าน project-design ceremony
คำขอแก้ failure ใช้ debugging; approved plan ไป execution;
workflow diagnosis ใช้ skill ใหม่; retrospective ต้องเป็นคำขอของผู้ใช้

canonical core ไม่ระบุชื่อ native invocation tool; adapter guidance บอกวิธี
load skill ที่ product นี้มีจริง ไม่ copy คำสั่ง `Skill` ของ Claude ไป Codex

ไม่เปลี่ยน native invocation metadata ในรอบนี้ เพราะ natural-language requests
เป็นส่วนหนึ่งของ existing AAA contract ต้องบันทึก deliberate difference จาก Matt
ให้ชัด การเพิ่ม UI metadata ไม่จำเป็นต่อ workflow refresh และอยู่นอก scope นี้

### 2. Intent-first design

- งานชัด เล็ก ย้อนกลับได้ และอยู่ในอำนาจที่มี: ลงมือได้โดยไม่สร้าง design
  document หรือถามยืนยันขั้นตอนธรรมดาซ้ำ
- งานเล็กแต่ผลลัพธ์ยังไม่ชัด: ถาม material question และตกลง full description
  ในแชตก่อน implementation
- งานที่เปลี่ยน architecture/interface หรือมีหลายส่วน: ใช้ written design
  และ builder check ก่อน executable plan
- ถามว่าผู้ใช้ต้องการอะไรและเพราะเหตุใดก่อนเสนอ solution ที่บังคับทิศทาง
  สำรวจ facts เอง; แจ้ง material assumptions; ทวนเฉพาะจุดที่ต้องตรวจความเข้าใจ
- ให้ทางเลือกข้าม interview ได้ แต่ไม่ข้าม authority, security และ irreversible
  action boundaries ผู้ใช้ไม่ต้องตอบคำถามที่ตรวจได้จาก repo
- visual companion เป็น optional ตามประโยชน์จริง คง local-first/CSP/no telemetry
- แทน spec-document reviewer companion ด้วย builder-check prompt
  ลบ companion เก่าเมื่อ references, inventory และ tests เปลี่ยนครบแล้วเท่านั้น

### 3. Plans describe decisions

แผนมี goal, spec path, global constraints, file responsibilities, exact interfaces,
dependency edges และ Review Focus ของ realistic inputs ที่ง่ายต่อการตกหล่น
หนึ่ง task เป็น vertical slice ที่มีผลลัพธ์ตรวจได้และมีค่าแก่การ review

test step ระบุ assertions และ exact values; code step ระบุ signature, file และ
decision ที่ implementer ตัดสินใจเองไม่ได้ ไม่ใส่ implementation body ทั้งชุด
เว้นแต่ algorithm หรือ exact copy เป็นสาระของ decision

ไม่มี placeholders, speculative scaffold, dependency installation หรือ automatic
commit task การ self-review ตรวจ coverage, consistency และ proportion
ลบ plan reviewer companion ที่ถูกแทนด้วย contract นี้หลังแก้ทุก reference

บันทึก execution method ไว้ ไม่ถามใหม่ถ้าผู้ใช้เลือกแล้ว:

- inline: implementer คือ session ปัจจุบัน; review อิสระเมื่อจบ branch
- SDD: fresh worker และ task review ต่อ task; final branch review อีกครั้ง

### 4. Execution, ledger and rulings

ทั้งสองโหมดใช้ task IDs, exact plan identity, base revision/tree snapshot,
bounded verification evidence และ resume contract ที่ใช้ helper เดิมร่วมกัน
inline ทำงานต่อเนื่องภายใน approved plan ไม่ถามว่าให้ทำ task ถัดไปหรือไม่

task brief ต้องพา spec pointer และ Global Constraints ที่ใช้กับทุก task ไปด้วย
โดยไม่บังคับ worker อ่านทั้งแผน; Interfaces ระบุสิ่งที่ task ใช้และส่งให้ task ถัดไป
tests ต้องตรวจผล brief จริงเมื่อ plan มี constraints และ headings ใน code fences

ข้อขัดแย้งเล็กน้อยแก้ด้วย `Ruling`: decision, evidence, reason และ cost if wrong
คง scope และ spec เป็นกรอบ ไม่ใช้ ruling เปลี่ยน security, data ownership,
public compatibility, billing, destructive scope หรือ external authority เอง

RED ที่ตั้งใจให้ fail ไม่ใช่ blocker แต่ GREEN/regression ที่ผิดต้อง debug
และแก้ภายใน task ก่อนทำต่อ failure นอกขอบเขตต้องรายงานพร้อมผลกระทบ
หยุดขอการตัดสินใจเมื่อมี material ambiguity หรือทำต่ออย่างถูกต้องไม่ได้

ถ้าเพิ่ม `task-start` และ `task-done` ให้เป็น Node helpers ใน owner skill
และ reuse SDD workspace/brief/atomic output protections ไม่สร้าง workspace
format อีกชุด ทุก helper dependency ต้องถูกส่งใน rendered package จริง
ไม่อ้าง script ที่มีเฉพาะใน source checkout

completion helper ต้องใช้ executable + argument array, ไม่แปล string เป็น shell;
รักษา Unicode, spaces, exit code, full bounded log และ silent successful output
ไม่เขียน completed เมื่อ test fail หรือ process launch fail
direct executable ที่ host รันไม่ได้ต้อง error ชัด ไม่ fallback ไป shell โดยเงียบ
คู่มือ Windows ต้องมีคำสั่งที่ใช้งานได้ด้วย runtime ที่ประกาศไว้

SDD ยังคง one writer at a time ใน shared checkout; parallel writers ต้องมี
separate verified worktrees และ scope ที่ไม่ทับกันตาม native capabilities
preserve inherited context ที่ native product กำหนด ไม่ override model เอง
review range ต้องไม่ว่างและสัมพันธ์กับ base จริง รองรับงาน uncommitted
โดยไม่สร้าง commit หรือแก้ user index

### 5. Tests and review

- test behavior ที่ public seam; expected value มาจาก spec/worked example
  ห้าม test ที่คำนวณคำตอบซ้ำตาม implementation
- focused check ก่อน แล้ว relevant project suite ก่อน completion;
  อย่าอ้างว่า whole suite ผ่านจาก focused file เดียว
- รักษา working code; mutation/repro ต้องอยู่ใน disposable copy เมื่อจำเป็น
  และพิสูจน์ว่า mutation เปลี่ยนจริงก่อนเชื่อ RED
- debugging ต้อง retest original scenario หลัง minimization และ fix
- review แยก Standards และ Spec verdicts; heuristics ไม่กลายเป็น hard rule
- realistic user inputs เป็น review concern แม้ spec ไม่แจกแจงทุกกรณี
- `Declined to judge` ต้องระบุสิ่งที่กันออกและเหตุผล; coordinator จัดการทุกข้อ
- native capability ที่ไม่มีต้องระบุ not run; ห้ามสร้างผล dispatch หรือผลทดสอบ

### 6. New skills

| Skill | Responsibility | Required boundary |
| --- | --- | --- |
| `domain-modeling` | ศัพท์ domain, context map และ ADR ที่มีเหตุผล | อ่านก่อน; สร้าง glossary/ADR เมื่อมีสาระจริง; migration จาก CONTEXT ไม่ลบทิ้งเอง |
| `pr` | ร่าง PR body: summary, evidence, merge danger | draft ไม่เท่ากับ permission ส่ง; เคารพ repo template; เก็บ Matt/Dex attribution |
| `retro` | วิเคราะห์ session เพื่อปรับ navigation/checks/instructions/tool use | ทำเมื่อผู้ใช้ร้องขอ; เสนอ findings ก่อน; mechanical check ก่อน prose rule |
| `diagnosing-agent-workflows` | วิเคราะห์ skill routing, repeated work, ignored plan และ effort/cost จาก evidence | scoped session only; read-only original; bounded excerpts; path:line evidence; no invented metrics |

diagnosis ไม่รวม telemetry, provider pricing guesses หรือ automatic exports
ค้น transcript ด้วย documented adapter capability หรือ user-supplied path เท่านั้น
ถ้า transport/path ไม่มีหลักฐาน ให้รายงาน unavailable และใช้ evidence ที่มี
ห้าม scan ทั้ง home directory ไม่ archive/upload/comment/open issue เอง
redaction และ export ถ้าผู้ใช้ขอภายหลังต้องมี focused privacy review แยก

ไม่เพิ่ม `tdd`, `diagnosing-bugs`, `code-review`, `grilling` หรือ `implement-spec`
ซ้ำ ใช้บทเรียนเหล่านี้ใน workflow ของ AAA ที่รับผิดชอบเรื่องเดียวกัน
คง `resolving-merge-conflicts` และ local safety/performance/migration skills
ไว้เป็น intentional divergence จนกว่าจะมี redundancy proof

## File ownership and integration

- `core/skills/`: workflow bodies และ owned companions ที่เปลี่ยนจริง
- `core/evals/skill-routing/`, `tests/lint/skills/`: trigger/non-trigger/pressure
  cases คู่กับ skill ที่แก้ ไม่เรียก regex assertions ว่า model behavior
- `core/inventory.json`, `core/presentation/emoji-registry.json`: portfolio และ assets
- `core/schemas/inventory.schema.json`: อัปเดต skill/source cardinality จาก 27
  เป็น 31 พร้อม coverage tests; ห้ามแก้ inventory โดยทิ้ง schema constraint เก่าไว้
- `core/upstreams.json` และ focused contract test: pinned provenance และ coverage
- adapters/manifests/snapshots: เปลี่ยนเมื่อ output contract ต้องเปลี่ยนเท่านั้น
- `tests/model/`: ขยาย changed-skill coverage ตาม runner contract;
  แยก self-reported routing จาก observed skill/tool/action evidence
- docs: workflow, skill development, upstream update guide, limits และ README count
- package version: feature update เป็น `2.4.0` เมื่อ implementation และ release
  contracts ผ่าน; เป็น metadata change ไม่ใช่อำนาจ commit/release/publish

## Error handling and migration

คง fail-closed containment, regular-file/link checks, deterministic manifests,
source hashes และ ownership pruning installer ต้องไม่แตะ unknown neighbors
ลบเฉพาะ superseded owned companions ที่ประกาศใน inventory และมี tests รองรับ

rendered package ต้องไม่อ้าง old reviewer files หลังเปลี่ยนชื่อ;
ไม่เอา remote telemetry/logo/CDN กลับมา คำสั่งทุก platform ใช้ native path APIs
และ interpreter ที่ประกาศจริง ไม่พึ่ง executable bits หรือ Bash บน Windows

`CONTEXT.md` ของผู้ใช้ไม่ถูก rename/delete อัตโนมัติ การอ่าน legacy domain docs
ต้องบอกชื่อที่พบและเสนอย้ายอย่างชัดเจนเมื่อจำเป็น ไม่สร้างข้อมูลสองชุดที่ขัดกัน

## Acceptance and evidence

1. provenance resolve ไป pinned upstream commit และทุก canonical skill มี disposition
2. portfolio หลังเพิ่มตรงกันทุก surface และทุก profile; companions ครบและไม่มี stale links
3. focused lint/contract tests แสดง intended RED ก่อน production changes และ GREEN หลังแก้
4. behavior-changing helpers มี runnable tests ที่ public CLI seam รวม failure,
   silent output, Unicode/space paths, shell metacharacters, link refusal และ no implicit commit
5. `npm run sync:status`, `npm run quality:quick`, `npm run quality:full` มี current results
6. render ทุก surface/both profiles ใน disposable test roots; deterministic output และ source hash ผ่าน
7. manual model cases ของ routing/workflow ที่เปลี่ยนรายงาน actual PASS/FAIL หรือ
   `NOT_RUN_UNAVAILABLE`; ถ้าไม่ได้รัน ให้รายงาน `lint-verified, model run pending`
8. native registration/trust/active/runtime, macOS และ Desktop/IDE ที่ยังไม่สังเกต
   แยกเป็น `NOT_RUN_UNAVAILABLE`; static tests ไม่ยกระดับ lifecycle
9. งาน web instructions และ unowned files เดิมยังอยู่; ไม่มี live config/Git side effect
10. final report ระบุ changed paths, branch/commit, exact checks, findings และ remaining risks

## Pre-mortem

| ความเสี่ยง | การป้องกัน |
| --- | --- |
| เอา main ที่ยังทดลองมาใช้เป็น stable | pin SHA, record maturity, disposition ทุก source group |
| Workflow ขัดกันหรือถามซ้ำ | routing cases, owner เดียวต่อ responsibility, no duplicate executors |
| ลด safety เพื่อให้ดู autonomous | preserve authority/denies และ focused regression |
| helper ใช้ได้เฉพาะ source checkout | public tests จาก rendered package บน disposable paths |
| CLI tests ผ่านแต่ model ไม่ทำตาม | แยก evidence layers และทดสอบ actual model behavior เมื่อ prerequisites พร้อม |
| ลบไฟล์ใหม่ของงานก่อนหน้า | initial dirty-path record และ final diff review |
| instruction bloat | ตัด repeated general rules; plan บันทึก decisions; source reference อยู่ใน owner skill |

## Review and handoff

Independent builder/spec review: Approved by `upstream_refresh_spec_review`.
No implementation-blocking findings. Advisory corrections to sync exit status,
invocation wording and inventory schema cardinality are incorporated.
Human acceptance of this written design: approved, 2026-10-20.
The human also authorized writing the plan and executing it without asking
for a second plan approval. This supersedes the default second approval gate.
Executable implementation plan: [implementation plan](2026-10-20-upstream-refresh-plan.md).

routine file names, Node helper structure และ test implementation อยู่ในหน้าที่ implementer
ภายใต้ acceptance criteria ด้านบน ไม่ขอรับรอง task ธรรมดาซ้ำ
