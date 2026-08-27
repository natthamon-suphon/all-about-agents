#!/usr/bin/env bash
# ==============================================================================
# All About Agents — Antigravity Setup Script (macOS / Linux Bash)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GEMINI_DIR="${HOME}/.gemini"
CONFIG_DIR="${GEMINI_DIR}/config"
PLUGINS_DIR="${CONFIG_DIR}/plugins"
TARGET_PLUGIN_DIR="${PLUGINS_DIR}/all-about-agents"
TARGET_SKILLS_DIR="${CONFIG_DIR}/skills"

echo "======================================================"
echo "  All About Agents — Antigravity Global Setup"
echo "======================================================"
echo "Repository Root : ${REPO_ROOT}"
echo "Gemini Config   : ${CONFIG_DIR}"
echo ""

# 1. Check Node.js
echo "[1/6] Checking prerequisites..."
if command -v node >/dev/null 2>&1; then
    echo "  ✓ Node.js detected: $(node -v)"
else
    echo "  ! Warning: Node.js is not found on PATH. Lifecycle hooks require Node.js."
fi

# 2. Ensure Directories
echo "[2/6] Preparing directories..."
mkdir -p "${GEMINI_DIR}" "${CONFIG_DIR}" "${PLUGINS_DIR}" "${TARGET_PLUGIN_DIR}" "${TARGET_SKILLS_DIR}"

# 3. Create Plugin Symlinks & Manifest
echo "[3/6] Configuring global plugin 'all-about-agents'..."

# Skills symlink
rm -f "${TARGET_PLUGIN_DIR}/skills"
ln -s "${REPO_ROOT}/skills" "${TARGET_PLUGIN_DIR}/skills"
echo "  ✓ Linked skills: ${TARGET_PLUGIN_DIR}/skills -> ${REPO_ROOT}/skills"

# Hooks symlink
rm -f "${TARGET_PLUGIN_DIR}/hooks"
ln -s "${REPO_ROOT}/hooks" "${TARGET_PLUGIN_DIR}/hooks"
echo "  ✓ Linked hooks: ${TARGET_PLUGIN_DIR}/hooks -> ${REPO_ROOT}/hooks"

# Manifest
if [ -f "${REPO_ROOT}/.claude-plugin/plugin.json" ]; then
    cp "${REPO_ROOT}/.claude-plugin/plugin.json" "${TARGET_PLUGIN_DIR}/plugin.json"
    echo "  ✓ Copied plugin.json"
fi

# Hooks Config
if [ -f "${REPO_ROOT}/hooks/antigravity-hooks.json" ]; then
    cp "${REPO_ROOT}/hooks/antigravity-hooks.json" "${TARGET_PLUGIN_DIR}/hooks.json"
    cp "${REPO_ROOT}/hooks/antigravity-hooks.json" "${CONFIG_DIR}/hooks.json"
    echo "  ✓ Configured hooks.json"
fi

# 4. Configure skills.json
echo "[4/6] Updating ~/.gemini/config/skills.json..."
cat <<EOF > "${CONFIG_DIR}/skills.json"
{
  "entries": [
    {
      "path": "${REPO_ROOT}/skills"
    }
  ]
}
EOF
echo "  ✓ Wrote skills.json"

# 5. Link individual skills in ~/.gemini/config/skills/
echo "[5/6] Linking individual skills into ~/.gemini/config/skills/..."
count=0
for skill_dir in "${REPO_ROOT}/skills"/*; do
    if [ -d "$skill_dir" ]; then
        skill_name="$(basename "$skill_dir")"
        rm -f "${TARGET_SKILLS_DIR}/${skill_name}"
        ln -s "$skill_dir" "${TARGET_SKILLS_DIR}/${skill_name}"
        count=$((count + 1))
    fi
done
echo "  ✓ Verified ${count} skills linked in ${TARGET_SKILLS_DIR}"

# 6. Link GEMINI.md Rules
echo "[6/6] Linking global rules (~/.gemini/GEMINI.md)..."
if [ -f "${REPO_ROOT}/configs/GEMINI.local.md" ]; then
    rm -f "${GEMINI_DIR}/GEMINI.md"
    ln -s "${REPO_ROOT}/configs/GEMINI.local.md" "${GEMINI_DIR}/GEMINI.md"
    echo "  ✓ Linked ${GEMINI_DIR}/GEMINI.md -> ${REPO_ROOT}/configs/GEMINI.local.md"
fi

echo ""
echo "======================================================"
echo "  Setup Completed Successfully! 🎉"
echo "======================================================"
echo "To start using All About Agents in Antigravity:"
echo "  1. Start a new chat session in Antigravity CLI (agy) or Antigravity IDE."
echo "  2. Test with: 'Let'\''s make a react todo list'"
echo ""
