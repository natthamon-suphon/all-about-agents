#!/usr/bin/env node
// Claude Code statusline - beautiful multi-line dashboard with animated buddy
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// ── ANSI helpers ────────────────────────────────────────────────
const RST = '\x1b[0m';
const c = {
  cyan: (s) => `\x1b[1;36m${s}${RST}`,
  green: (s) => `\x1b[32m${s}${RST}`,
  magenta: (s) => `\x1b[1;35m${s}${RST}`,
  yellow: (s) => `\x1b[33m${s}${RST}`,
  blue: (s) => `\x1b[34m${s}${RST}`,
  boldGreen: (s) => `\x1b[1;32m${s}${RST}`,
  red: (s) => `\x1b[1;31m${s}${RST}`,
  dim: (s) => `\x1b[2m${s}${RST}`,
  boldCyan: (s) => `\x1b[1;36m${s}${RST}`,
  pink: (s) => `\x1b[38;5;213m${s}${RST}`,
  orange: (s) => `\x1b[38;5;208m${s}${RST}`,
  lavender: (s) => `\x1b[38;5;183m${s}${RST}`,
};
const sep = c.dim(' \u2502 ');

// ── Random emoji picker ─────────────────────────────────────────
const EMOJIS = [
  '\ud83d\udc96', '\u2728', '\ud83c\udf38', '\ud83e\udd8b', '\ud83d\udcab',
  '\ud83c\udf1f', '\ud83c\udf80', '\ud83c\udf3a', '\ud83d\udc9c', '\ud83e\udebb',
  '\ud83e\udee7', '\ud83c\udf08', '\ud83d\udc8e', '\ud83c\udf19', '\u2b50',
  '\ud83c\udfaf', '\ud83d\udd2e', '\ud83c\udf40', '\ud83c\udf37', '\ud83d\udc90',
];
const getEmoji = () => EMOJIS[Math.floor(Date.now() / 1500) % EMOJIS.length];

// ── Rate limit progress bar ─────────────────────────────────────
const rateBar = (pct) => {
  const width = 15;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  // Gradient: green → cyan → yellow → orange → red as usage increases
  const colorFn = pct > 85 ? c.red : pct > 70 ? c.orange : pct > 50 ? c.yellow : pct > 30 ? c.cyan : c.green;
  return colorFn('\u2588'.repeat(filled)) + c.dim('\u2591'.repeat(empty));
};
const rateColor = (pct) => pct > 85 ? c.red : pct > 70 ? c.orange : pct > 50 ? c.yellow : pct > 30 ? c.cyan : c.green;

// ── Format reset countdown ──────────────────────────────────────
const fmtReset = (resetsAt) => {
  if (!resetsAt) return '';
  const diffSecs = Math.max(0, resetsAt - Math.floor(Date.now() / 1000));
  const hrs = Math.floor(diffSecs / 3600);
  const mins = Math.floor((diffSecs % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
};

// ── Format weekly reset as day + time ───────────────────────────
const fmtResetDate = (resetsAt) => {
  if (!resetsAt) return '';
  const d = new Date(resetsAt * 1000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[d.getDay()];
  let hrs = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const ampm = hrs >= 12 ? 'PM' : 'AM';
  hrs = hrs % 12 || 12;
  return `${day} ${hrs}:${mins} ${ampm}`;
};

// ── Weekly limit mini bar for separator line ────────────────────
const weeklyBar = (pct, totalWidth) => {
  const filled = Math.round((pct / 100) * totalWidth);
  const empty = totalWidth - filled;
  const colorFn = pct > 85 ? c.red : pct > 70 ? c.orange : pct > 50 ? c.yellow : pct > 30 ? c.cyan : c.green;
  return colorFn('\u2500'.repeat(filled)) + c.dim('\u2500'.repeat(empty));
};

// ── Token formatter ─────────────────────────────────────────────
const fmtTokens = (t) => {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
  if (t >= 1_000) return `${Math.round(t / 1_000)}k`;
  return `${t}`;
};

// ── Strip ANSI for length calculation ───────────────────────────
const visLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

// ── Main ────────────────────────────────────────────────────────
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const W = process.stdout.columns || 90;

    // Data extraction
    const repo = (data?.workspace?.project_dir || 'unknown').split(/[/\\]/).filter(Boolean).pop();
    let branch = data?.worktree?.branch || '';
    if (!branch) {
      try { branch = execSync('git branch --show-current', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim(); }
      catch { branch = 'N/A'; }
    }
    const model = data?.model?.display_name || 'unknown';
    const inputTokens = data?.context_window?.total_input_tokens || 0;
    const outputTokens = data?.context_window?.total_output_tokens || 0;
    const ratePct5h = Math.round(data?.rate_limits?.five_hour?.used_percentage || 0);
    const resets5h = data?.rate_limits?.five_hour?.resets_at || 0;
    const ratePct7d = Math.round(data?.rate_limits?.seven_day?.used_percentage || 0);
    const resets7d = data?.rate_limits?.seven_day?.resets_at || 0;
    const sessionId = data?.session_id || 'default';
    const logDir = path.join(os.tmpdir(), 'claude-statusline');
    const readUnique = (file) => {
      try {
        return [...new Set(fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean))].join(', ');
      } catch { return ''; }
    };
    const agents = readUnique(path.join(logDir, `${sessionId}-agents.log`));
    const skills = readUnique(path.join(logDir, `${sessionId}-skills.log`));
    const durationMs = data?.cost?.total_duration_ms || 0;
    const totalSecs = Math.floor(durationMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;

    // ── Line 1: Repo + Model ─────────────────────────────────
    const line1 = `\ud83d\udcc2 ${c.cyan(repo)}  \ud83d\udd00 ${c.green(branch)}${sep}\ud83e\udde0 ${c.magenta(model)}`;

    // ── Line 3: Metrics or loading ────────────────────────────
    const isLoading = ratePct5h === 0 && inputTokens === 0 && outputTokens === 0;
    let line3;
    if (isLoading) {
      line3 = c.dim('Loading...');
    } else {
      const resetStr = resets5h ? c.dim(' \u00b7 ') + c.lavender(fmtReset(resets5h)) : '';
      const metricsSegments = [
        `\u23f3 ${rateBar(ratePct5h)} ${rateColor(ratePct5h)(`${ratePct5h}%`)}${resetStr}`,
        `\ud83d\udd24 ${c.yellow(fmtTokens(inputTokens))} \u2193 ${c.orange(fmtTokens(outputTokens))} \u2191`,
        `\u23f1\ufe0f  ${c.blue(`${mins}m ${secs}s`)}`,
      ];
      if (agents) metricsSegments.push(`\ud83e\udd16 ${c.boldGreen(agents)}`);
      if (skills) metricsSegments.push(`\u26a1 ${c.boldCyan(skills)}`);
      line3 = metricsSegments.join(sep);
    }

    // ── Line 2: Weekly limit bar + name ───────────────────────
    const contentW = Math.max(visLen(line1), visLen(line3));
    const nameStr = '   ' + getEmoji() + ' Natthamon Suphon';
    const barWidth = Math.max(1, contentW + 1);
    const line2 = weeklyBar(ratePct7d, barWidth) + nameStr;

    process.stdout.write(`${line1}\n${line2}\n${line3}\n`);
    process.stdout.write(`.\n`);
  } catch (e) {
    process.stdout.write('statusline error: ' + e.message);
  }
});
