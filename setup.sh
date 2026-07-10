#!/usr/bin/env bash
#
# One-step setup for the SharePoint Page Migration Agent (macOS / Linux / WSL).
#
# Locates Node.js (even if it isn't on PATH yet) and adds it to your PATH,
# installs npm dependencies, builds the MCP server, runs a smoke test, verifies
# both MCP servers start, and ensures a .mcp.json config exists in the repo root.
#
# Usage:
#   ./setup.sh                # full setup
#   ./setup.sh --skip-test    # skip the post-build smoke test
#   ./setup.sh --force        # overwrite an existing .mcp.json with defaults
#   ./setup.sh --no-path-fix  # don't modify your PATH / shell profile
#
set -euo pipefail

SKIP_TEST=0
FORCE=0
NO_PATH_FIX=0
for arg in "$@"; do
  case "$arg" in
    --skip-test)   SKIP_TEST=1 ;;
    --force)       FORCE=1 ;;
    --no-path-fix) NO_PATH_FIX=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

# Colours (fall back to plain text when not a TTY).
if [ -t 1 ]; then
  C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'; C_GRAY=$'\033[90m'; C_RESET=$'\033[0m'
else
  C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_GRAY=''; C_RESET=''
fi

step() { printf '\n%s==> %s%s\n' "$C_CYAN" "$1" "$C_RESET"; }
ok()   { printf '    %s[ok] %s%s\n' "$C_GREEN" "$1" "$C_RESET"; }
info() { printf '    %s%s%s\n' "$C_GRAY" "$1" "$C_RESET"; }
warn() { printf '    %s[!] %s%s\n' "$C_YELLOW" "$1" "$C_RESET"; }
err()  { printf '    %s[x] %s%s\n' "$C_RED" "$1" "$C_RESET"; }

# Resolve the repository root as the directory this script lives in.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
MCP_DIR="$REPO_ROOT/mcp-server"

printf '%sSharePoint Page Migration Agent - setup%s\n' "$C_RESET" "$C_RESET"
info "Repo root: $REPO_ROOT"

if [ ! -d "$MCP_DIR" ]; then
  err "Could not find the 'mcp-server' folder next to this script."
  info "Run this script from inside the cloned repository."
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Node.js / npm
# ---------------------------------------------------------------------------
step "Checking Node.js and npm"

# Find a node binary even when it's not on PATH (official install dirs plus
# nvm / fnm / volta layouts). Prints the full path, or nothing if not found.
find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  local c
  for c in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node \
           "$HOME/.volta/bin/node" "$HOME/.local/bin/node" \
           "/c/Program Files/nodejs/node" "/c/Program Files (x86)/nodejs/node"; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  local d n
  for d in "$HOME/.nvm/versions/node" "$HOME/.local/share/fnm/node-versions" \
           "$HOME/.fnm/node-versions"; do
    if [ -d "$d" ]; then
      n="$(ls -d "$d"/*/bin/node 2>/dev/null | sort -V | tail -n1)"
      [ -n "$n" ] && [ -x "$n" ] && { printf '%s\n' "$n"; return 0; }
    fi
  done
  return 1
}

# Append an "export PATH" line for $1 to the user's shell profile (idempotent).
# Prints the profile path if it made a change.
persist_path() {
  local dir="$1" rc
  case "${SHELL:-}" in
    *zsh)  rc="$HOME/.zshrc" ;;
    *bash) rc="$HOME/.bashrc" ;;
    *)     rc="$HOME/.profile" ;;
  esac
  [ -f "$rc" ] || touch "$rc"
  if ! grep -qsF "export PATH=\"$dir:" "$rc"; then
    printf '\n# Added by SharePoint Page Migration Agent setup\nexport PATH="%s:$PATH"\n' "$dir" >> "$rc"
    printf '%s\n' "$rc"
  fi
}

WAS_ON_PATH=1
command -v node >/dev/null 2>&1 || WAS_ON_PATH=0

NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then
  err "Could not find Node.js anywhere on this machine."
  info "Install the LTS build from https://nodejs.org (or via your package manager),"
  info "then open a new terminal and run this script again."
  exit 1
fi

NODE_DIR="$(cd "$(dirname "$NODE_BIN")" && pwd)"

# Make node/npm/npx usable for the rest of THIS script run.
case ":$PATH:" in
  *":$NODE_DIR:"*) ;;
  *) PATH="$NODE_DIR:$PATH"; export PATH ;;
esac

# If Node wasn't on PATH, fix it so your AI host can spawn node/npx later.
if [ "$WAS_ON_PATH" -eq 0 ]; then
  warn "Node.js is installed at $NODE_DIR but was not on your PATH."
  if [ "$NO_PATH_FIX" -eq 1 ]; then
    warn "Skipping PATH fix (--no-path-fix). The MCP host may fail to start node/npx"
    warn "until you add $NODE_DIR to your PATH manually."
  else
    RC="$(persist_path "$NODE_DIR" || true)"
    if [ -n "${RC:-}" ]; then
      ok "Added $NODE_DIR to PATH in $RC"
      warn "IMPORTANT: run 'source $RC' (or open a new terminal), then restart your AI host."
    else
      ok "$NODE_DIR is already in your shell profile (restart your terminal/host to load it)."
    fi
  fi
fi

NODE_VERSION="$(node -v)"                 # e.g. v20.11.1
NODE_MAJOR="$(printf '%s' "$NODE_VERSION" | sed 's/^v//' | cut -d. -f1)"
ok "node $NODE_VERSION  ($NODE_BIN)"

if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  err "Node.js 20 or newer is required (found $NODE_VERSION)."
  info "Both the migration server and the playwright MCP server need Node.js 20+."
  info "Install the LTS build from https://nodejs.org, open a new terminal, and re-run."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  err "npm is not on your PATH (it normally installs alongside Node.js)."
  info "Reinstall Node.js from https://nodejs.org and try again."
  exit 1
fi
ok "npm $(npm -v)"

# ---------------------------------------------------------------------------
# 2-4. Install, build, test (inside mcp-server)
# ---------------------------------------------------------------------------
cd "$MCP_DIR"

step "Installing dependencies (npm install)"
npm install
ok "Dependencies installed"

step "Building the MCP server (npm run build)"
npm run build
ok "Build complete (dist/ generated)"

if [ "$SKIP_TEST" -eq 0 ]; then
  step "Running smoke test (test/test-safelinks.cjs)"
  node test/test-safelinks.cjs
  ok "Smoke test passed"
fi

step "Verifying the MCP server starts (initialize handshake)"
node test/check-server-start.cjs
ok "MCP server starts and responds"

step "Verifying the optional playwright MCP server (best-effort)"
if node test/check-playwright-start.cjs; then
  ok "playwright MCP server starts and responds"
else
  warn "Optional playwright MCP server did not start (needs network access to download it)."
  warn "Core migration still works without it. You can remove 'playwright' from .mcp.json if unused."
fi

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# 5. .mcp.json
# ---------------------------------------------------------------------------
step "Ensuring .mcp.json exists in the repo root"

MCP_JSON="$REPO_ROOT/.mcp.json"
if [ -f "$MCP_JSON" ] && [ "$FORCE" -eq 0 ]; then
  ok ".mcp.json already present (use --force to overwrite with defaults)"
else
  cat > "$MCP_JSON" <<'JSON'
{
  "mcpServers": {
    "classic-to-modern": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp-server/start.cjs"]
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
JSON
  ok ".mcp.json written"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
printf '\n%sSetup complete.%s\n' "$C_GREEN" "$C_RESET"
printf '%sNext steps:%s\n' "$C_RESET" "$C_RESET"
info "1. Start your AI host from this folder:  copilot   (or)   claude"
info "2. Run /mcp and confirm 'classic-to-modern' is loaded."
info "3. Ask it to migrate a classic SharePoint page URL."
