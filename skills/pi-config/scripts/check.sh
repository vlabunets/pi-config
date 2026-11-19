#!/usr/bin/env bash
# Sanity-check the pi config: JSON validity, skill frontmatter, extension manifests.
# Usage: check.sh [agent-dir]   (default: $PI_CODING_AGENT_DIR or ~/.pi/agent)
set -u
DIR="${1:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}}"
fail=0
ok()  { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s — %s\n' "$1" "$2"; fail=1; }

echo "JSON files"
for f in settings.json models.json router.json mcp.json trust.json keybindings.json \
         extensions/*/package.json extensions/*/config.json; do
  p="$DIR/$f"; [ -f "$p" ] || continue
  if python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$p" 2>/dev/null; then ok "$f"; else bad "$f" "invalid JSON"; fi
done

echo "Skills"
for s in "$DIR"/skills/*/SKILL.md; do
  [ -f "$s" ] || continue
  rel="${s#$DIR/}"; dirname="$(basename "$(dirname "$s")")"
  out=$(python3 - "$s" "$dirname" <<'PY'
import re, sys
path, d = sys.argv[1], sys.argv[2]
t = open(path, encoding="utf-8").read()
m = re.match(r"^---\n(.*?)\n---\n", t, re.S)
if not m: print("no frontmatter"); sys.exit()
fm = dict(re.findall(r"^([A-Za-z-]+):\s*(.*)$", m.group(1), re.M))
name, desc = fm.get("name", "").strip('"\''), fm.get("description", "").strip('"\'')
errs = []
if not name: errs.append("missing name")
elif not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name) or len(name) > 64: errs.append(f"bad name '{name}'")
elif name != d: errs.append(f"name '{name}' != dir '{d}' (warning)")
if not desc: errs.append("missing description")
elif len(desc) > 1024: errs.append(f"description {len(desc)} > 1024 chars")
print("; ".join(errs))
PY
)
  if [ -z "$out" ]; then ok "$rel"; elif [[ "$out" == *"(warning)"* && "$out" != *";"* ]]; then printf '  warn %s — %s\n' "$rel" "$out"; else bad "$rel" "$out"; fi
done

echo "Directory extensions"
for d in "$DIR"/extensions/*/; do
  n="$(basename "$d")"
  if [ -f "$d/index.ts" ] || [ -f "$d/index.js" ]; then entry=1
  elif [ -f "$d/package.json" ] && python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("pi",{}).get("extensions") else 1)' "$d/package.json" 2>/dev/null; then entry=1
  else entry=0; fi
  [ $entry = 1 ] || { bad "extensions/$n" "no index.ts/js or package.json pi.extensions"; continue; }
  if [ -f "$d/package.json" ] && python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("dependencies") else 1)' "$d/package.json" 2>/dev/null && [ ! -d "$d/node_modules" ]; then
    bad "extensions/$n" "has dependencies but no node_modules (run npm install)"
  else ok "extensions/$n"; fi
done

echo "LM Studio model references"
# Every lmstudio/<id> used in settings, router or agent frontmatter must exist in models.json.
# The "local" alias maps to a real LM Studio model via samplingParams.model; warn if LM Studio
# is running and doesn't know that target.
out=$(python3 - "$DIR" <<'PY'
import json, re, sys, glob, os, urllib.request
d = sys.argv[1]
ids = {m["id"]: m for m in json.load(open(f"{d}/models.json"))["providers"].get("lmstudio", {}).get("models", [])}
refs = []
s = json.load(open(f"{d}/settings.json"))
if s.get("defaultProvider") == "lmstudio": refs.append(("settings.json defaultModel", s.get("defaultModel")))
for role, m in s.get("observational-memory", {}).get("models", {}).items():
    if m.get("provider") == "lmstudio": refs.append((f"settings.json observational-memory.{role}", m.get("id")))
for tier, c in json.load(open(f"{d}/router.json")).items():
    if str(c.get("model", "")).startswith("lmstudio/"): refs.append((f"router.json {tier}", c["model"][9:]))
for f in glob.glob(f"{d}/agents/*.md") + glob.glob(f"{d}/agent-presets/*.md"):
    m = re.search(r"^model:\s*lmstudio/(\S+)", open(f).read(), re.M)
    if m: refs.append((os.path.relpath(f, d), m.group(1)))
for where, mid in refs:
    print(("ok  " if mid in ids else "FAIL") + f" {where} -> lmstudio/{mid}")
alias = ids.get("local", {}).get("samplingParams", {}).get("model")
if alias:
    try:
        loaded = {m["id"] for m in json.load(urllib.request.urlopen("http://localhost:1234/v1/models", timeout=2))["data"]}
        print(("ok  " if alias in loaded else "warn") + f" alias lmstudio/local -> {alias}" + ("" if alias in loaded else " (not known to LM Studio)"))
    except Exception:
        print(f"ok   alias lmstudio/local -> {alias} (LM Studio not running, not verified)")
PY
)
while IFS= read -r line; do
  case "$line" in
    "ok  "*) ok "${line:5}" ;;
    warn*) printf '  warn %s\n' "${line:5}" ;;
    FAIL*) bad "${line:5}" "unknown model id in models.json" ;;
  esac
done <<< "$out"

[ $fail = 0 ] && echo "All checks passed." || { echo "Some checks failed."; exit 1; }
