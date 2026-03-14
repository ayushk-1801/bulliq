#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Ensure Flask and Click are compatible (Flask needs click.core.ParameterSource).
python - <<'PY'
import sys

ok = True
try:
	from click.core import ParameterSource  # noqa: F401
except Exception:
	ok = False

if not ok:
	import subprocess
	subprocess.check_call(
		[sys.executable, "-m", "pip", "install", "--upgrade", "flask>=2.3,<3.1", "click>=8.1.7,<9"]
	)
PY

python app.py
