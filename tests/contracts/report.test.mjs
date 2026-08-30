import assert from "node:assert/strict";
import test from "node:test";

import { formatDiffText } from "../../installers/lib/report.mjs";

test("formatDiffText renders a redacted mode-only change", () => {
  const output = formatDiffText([{
    surface: "claude",
    relativePath: "hooks/run.mjs",
    kind: "replace",
    oldMode: 0o644,
    newMode: 0o755,
    diff: ""
  }]);
  assert.equal(output, "diff --git a/hooks/run.mjs b/hooks/run.mjs\nold mode 100644\nnew mode 100755\n");
  assert.match(output, /old mode 100644\nnew mode 100755/u);
  assert.doesNotMatch(output, /secret|#!/u);
});

test("formatDiffText preserves deterministic redacted content diffs without mode noise", () => {
  const output = formatDiffText([{
    surface: "claude",
    relativePath: "settings.json",
    kind: "replace",
    oldMode: 0o600,
    newMode: 0o600,
    diff: "--- a/settings.json\n+++ b/settings.json\n@@ -1 +1 @@\n-[REDACTED] sha256=old bytes=4\n+[REDACTED] sha256=new bytes=4"
  }]);
  assert.equal(output, "--- a/settings.json\n+++ b/settings.json\n@@ -1 +1 @@\n-[REDACTED] sha256=old bytes=4\n+[REDACTED] sha256=new bytes=4\n");
  assert.doesNotMatch(output, /old mode|new mode|secret|token-value/u);
});
