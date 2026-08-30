#!/usr/bin/env bash
# Find the first test that creates unwanted filesystem state.
# Usage: ./find-polluter.sh <file_or_dir_to_check> <test_pattern> [runner]
# The optional runner is a package-manager command (npm, pnpm, yarn, bun) or
# an executable path. TEST_RUNNER provides the same override for CI.

set -u

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <file_to_check> <test_pattern> [runner]" >&2
  echo "Example: $0 '.git' 'src/**/*.test.ts' npm" >&2
  exit 2
fi

POLLUTION_CHECK=$1
TEST_PATTERN=${2#./}
RUNNER_OVERRIDE=${3:-${TEST_RUNNER:-}}

echo "Searching for test that creates: $POLLUTION_CHECK"
echo "Test pattern: $TEST_PATTERN"

# Keep paths as array elements. Word-splitting a newline- or space-containing
# path is both incorrect and capable of running the wrong file.
TEST_FILES=()
COLLAPSED_PATTERN=${TEST_PATTERN//\*\*\//}
while IFS= read -r -d '' TEST_FILE; do
  TEST_FILES+=("$TEST_FILE")
done < <(find . -type f \( -path "./$TEST_PATTERN" -o -path "./$COLLAPSED_PATTERN" \) -print0)

TOTAL=${#TEST_FILES[@]}
echo "Found $TOTAL test files"

if [ "$TOTAL" -eq 0 ]; then
  echo "ERROR: no test files matched '$TEST_PATTERN'; refusing to report a clean run" >&2
  exit 4
fi

# Existing state is evidence about the caller's setup, not evidence that the
# first test created it. Refuse to guess and leave the state untouched.
if [ -e "$POLLUTION_CHECK" ] || [ -L "$POLLUTION_CHECK" ]; then
  echo "ERROR: pre-existing pollution at '$POLLUTION_CHECK'; remove or isolate it and rerun" >&2
  exit 3
fi

select_runner() {
  if [ -n "$RUNNER_OVERRIDE" ]; then
    printf '%s' "$RUNNER_OVERRIDE"
  elif [ -f pnpm-lock.yaml ]; then
    printf '%s' pnpm
  elif [ -f yarn.lock ]; then
    printf '%s' yarn
  elif [ -f bun.lockb ] || [ -f bun.lock ]; then
    printf '%s' bun
  else
    printf '%s' npm
  fi
}

RUNNER=$(select_runner)
RUNNER_STATUS=0
COUNT=0

for TEST_FILE in "${TEST_FILES[@]}"; do
  COUNT=$((COUNT + 1))
  echo "[$COUNT/$TOTAL] Testing: $TEST_FILE (runner: $RUNNER)"

  # Pass the filename as one argument. Do not use eval or a command string.
  "$RUNNER" test -- "$TEST_FILE"
  TEST_STATUS=$?
  if [ "$TEST_STATUS" -ne 0 ]; then
    echo "ERROR: test failed (exit $TEST_STATUS): $TEST_FILE" >&2
    RUNNER_STATUS=5
  fi

  if [ -e "$POLLUTION_CHECK" ] || [ -L "$POLLUTION_CHECK" ]; then
    echo "FOUND POLLUTER: $TEST_FILE"
    echo "Created or changed: $POLLUTION_CHECK"
    ls -la -- "$POLLUTION_CHECK" 2>/dev/null || ls -ld -- "$POLLUTION_CHECK"
    exit 1
  fi
done

if [ "$RUNNER_STATUS" -ne 0 ]; then
  echo "ERROR: one or more test commands failed; no polluter conclusion is valid" >&2
  exit "$RUNNER_STATUS"
fi

echo "No polluter found - all tests ran successfully and clean"
exit 0
