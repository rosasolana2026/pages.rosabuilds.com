#!/usr/bin/env bash
# gen-demo-video.sh — generate a 30-second demo video for pages.rosabuilds.com
# Uses Python+Pillow for frame rendering (drawtext unavailable in this ffmpeg build)
# Output: static/demo.mp4
#
# Usage:
#   cd /path/to/pages-rosabuilds
#   bash scripts/gen-demo-video.sh
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"

echo "→ Checking dependencies..."
python3 -c "from PIL import Image" 2>/dev/null || { echo "ERROR: Pillow not installed. Run: pip install Pillow"; exit 1; }
ffmpeg -version >/dev/null 2>&1 || { echo "ERROR: ffmpeg not found."; exit 1; }

echo "→ Running Python frame renderer..."
python3 scripts/gen-demo-video.py

echo "✓ Done. Video at: static/demo.mp4"
