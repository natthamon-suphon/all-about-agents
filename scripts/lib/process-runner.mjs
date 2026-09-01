import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const HARD_KILL_DELAY_MS = 500;
const FORCE_SETTLE_DELAY_MS = 1_000;

function validateEnvironment(value, label) {
  if (value === undefined) return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object when supplied`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || key.includes("\0")) {
      const error = new TypeError(`${label} keys must not contain null bytes`);
      error.code = "invalid-environment-key";
      throw error;
    }
    if (typeof value[key] !== "string" || value[key].includes("\0")) {
      const error = new TypeError(`${label} values must be strings without null bytes`);
      error.code = "invalid-environment-value";
      throw error;
    }
  }
}

function validateInput({ executable, args, cwd, env, envOverrides, timeoutMs, maxOutputBytes }) {
  if (typeof executable !== "string" || executable.trim() === "" || executable.includes("\0")) {
    throw new TypeError("executable must be a non-empty string");
  }
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string" || value.includes("\0"))) {
    throw new TypeError("args must be an array of strings without null bytes");
  }
  if (cwd !== undefined && (typeof cwd !== "string" || cwd.trim() === "" || cwd.includes("\0"))) {
    throw new TypeError("cwd must be a non-empty string when supplied");
  }
  if (env !== undefined && envOverrides !== undefined) {
    const error = new TypeError("provide either env or envOverrides, not both");
    error.code = "conflicting-environment";
    throw error;
  }
  validateEnvironment(env, "env");
  validateEnvironment(envOverrides, "envOverrides");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new TypeError("maxOutputBytes must be a positive integer");
  }
}

/**
 * Execute one native program without a command shell.
 *
 * Non-zero program exits are returned to the caller. A missing executable is
 * represented by `unavailable: true`; other spawn failures reject the promise.
 */
export async function runProcess({
  executable,
  args = [],
  cwd,
  env,
  envOverrides,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES
} = {}) {
  validateInput({ executable, args, cwd, env, envOverrides, timeoutMs, maxOutputBytes });
  // Callers may provide a small, explicit override set without receiving or
  // serializing the ambient environment. PATH and native lookup stay inside
  // this production runner, where child_process needs them.
  const processEnvironment = envOverrides === undefined ? env : { ...process.env, ...envOverrides };

  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let timedOut = false;
    let outputTooLarge = false;
    let settled = false;
    let terminating = false;
    let timer;
    let hardKillTimer;
    let forceSettleTimer;

    const clearTimers = () => {
      clearTimeout(timer);
      clearTimeout(hardKillTimer);
      clearTimeout(forceSettleTimer);
    };

    const boundedText = (value, remainingBytes) => {
      const source = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
      let buffer = source.subarray(0, Math.max(0, remainingBytes));
      let text = buffer.toString("utf8");
      while (Buffer.byteLength(text, "utf8") > remainingBytes && buffer.length > 0) {
        buffer = buffer.subarray(0, -1);
        text = buffer.toString("utf8");
      }
      return text;
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimers();
      const stdoutText = boundedText(Buffer.concat(stdout), maxOutputBytes);
      const stderrBudget = Math.max(0, maxOutputBytes - Buffer.byteLength(stdoutText, "utf8"));
      resolve({
        exitCode: result.exitCode,
        stdout: stdoutText,
        stderr: boundedText(result.stderr === undefined ? Buffer.concat(stderr) : result.stderr, stderrBudget),
        signal: result.signal ?? null,
        unavailable: result.unavailable ?? false,
        timedOut,
        outputTooLarge
      });
    };

    const terminate = () => {
      if (settled || terminating) return;
      terminating = true;
      child?.kill();
      hardKillTimer = setTimeout(() => {
        if (settled) return;
        child?.kill("SIGKILL");
        forceSettleTimer = setTimeout(() => finish({ exitCode: null, signal: "SIGKILL" }), FORCE_SETTLE_DELAY_MS);
        forceSettleTimer.unref?.();
      }, HARD_KILL_DELAY_MS);
      hardKillTimer.unref?.();
    };

    const capture = (target, chunk) => {
      if (settled) return;
      const buffer = Buffer.from(chunk);
      const remaining = Math.max(0, maxOutputBytes - capturedBytes);
      if (remaining > 0) {
        const retained = buffer.subarray(0, remaining);
        target.push(retained);
        capturedBytes += retained.length;
      }
      if (buffer.length > remaining) {
        outputTooLarge = true;
        terminate();
      }
    };

    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        env: processEnvironment,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      clearTimers();
      reject(error);
      return;
    }

    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));

    child.once("error", (error) => {
      if (error?.code === "ENOENT") {
        finish({
          exitCode: null,
          unavailable: true,
          stderr: error.message,
          signal: null
        });
        return;
      }
      if (!settled) {
        settled = true;
        clearTimers();
        reject(error);
      }
    });

    child.once("close", (exitCode, signal) => {
      finish({ exitCode, signal });
    });

    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref?.();
  });
}

export { DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_TIMEOUT_MS };
