#!/bin/bash
# Agent Hive installer for macOS.
#   curl -fsSL https://raw.githubusercontent.com/ericwang915/agent-hive/main/install.sh | bash
# Downloads the latest release for this Mac's CPU, puts it in /Applications and opens it.
set -euo pipefail

REPO="ericwang915/agent-hive"
APP="Agent Hive.app"

[ "$(uname -s)" = "Darwin" ] || { echo "Agent Hive only runs on macOS." >&2; exit 1; }
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

DEST="/Applications"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Agent Hive ($ARCH)…"
curl -fL --progress-bar -o "$TMP/app.zip" "https://github.com/$REPO/releases/latest/download/Agent-Hive-$ARCH.zip"

echo "Installing to $DEST…"
ditto -x -k "$TMP/app.zip" "$TMP/out"
[ -d "$TMP/out/$APP" ] || { echo "The download did not contain $APP." >&2; exit 1; }
if pgrep -f "$DEST/$APP/Contents/MacOS/" >/dev/null 2>&1; then
  osascript -e 'tell application "Agent Hive" to quit' >/dev/null 2>&1 || true
  sleep 2
fi
rm -rf "$DEST/$APP"
mv "$TMP/out/$APP" "$DEST/$APP"
echo "Installed: $DEST/$APP"
open "$DEST/$APP"
