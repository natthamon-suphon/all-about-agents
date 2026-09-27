# Conflict Scan Before Task 1

**Load this reference when:** a subagent-driven-development plan is approved
and Task 1 has not been dispatched yet.

Read the plan once. If it names a spec, read that too: the spec is the
authority the plan argues from, and conflicts inside the plan resolve against
it. Then scan the plan for conflicts and write the scan into the ledger as a
table, not a verdict:

- one row for every pair of tasks that share a file or an interface: the two
  tasks, what one produces against what the other consumes, and what you found;
- one row for every task: whether its own text agrees with itself (the tests it
  specifies against the code it specifies, the files it creates against the
  files it later touches);
- one row for anything the plan mandates that the review rubric treats as a
  defect (a test that asserts nothing, a duplicated logic block).

"The scan is clean" without those rows is not a scan you ran. Rule on every
finding before dispatching Task 1 and record each ruling beside its row as
`Ruling: <decision> — <why> — <cost if wrong>`. The review loop remains the net
for conflicts that only emerge from implementation; a non-catastrophic
conflict found later gets a ruling and the plan continues.
