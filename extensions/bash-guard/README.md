# bash-guard (pi extension)

Intercepts agent-issued `bash` tool calls and applies different protection depending on whether
the session is interactive (main session) or non-interactive (spawned subagent).

## Modes

Behaviour is determined at registration time via the `PI_SUBAGENT_DEPTH` environment variable,
which pi-subagents injects into every spawned process.

### Main session (`PI_SUBAGENT_DEPTH` = 0 or unset) — interactive prompt

- Heuristically detects destructive/questionable commands via shell-aware parsing
- Prompts for **any** `git ...` command (escalates severity for especially risky ones: `git rm`,
  `git reset --hard`, `git clean -fdx`, `git push --force`, `git reflog expire`, `git gc --prune`)
- Prompts for disk/volume tooling: `diskutil`, `hdiutil`, `mkfs*`, `newfs_*`, `wipefs`, `parted`,
  `fdisk`, `gdisk/sgdisk`, `cryptsetup`, `pvcreate/vgcreate/lvcreate`, `zpool`, `lsblk`
- Prompts for: `rm`/`rmdir`/`unlink`, `sudo`, `find -delete`, `dd`, `truncate`, `sed -i`,
  `perl -pi`, `chmod/chown -R`, `mv/cp --force`, `kill`/`pkill`/`killall`, `shutdown`/`reboot`,
  `systemctl stop/disable`, `curl|sh`/`wget|sh`, `kubectl delete`, `terraform destroy`,
  `aws s3 rm --recursive`, `gcloud delete`, shell redirections (`>`, `>>`, `2>`), pipes
- **Read-only allowlist** (never prompts): commands where every stage is one of `rg`, `grep`/`egrep`/
  `fgrep`, `cat`, `head`, `tail`, `wc`, `cut`, `tr`, `nl`, `column`, `sort`, `uniq`, `diff`, `jq`,
  `awk`, `sed`, `find`, `ls`, `pwd`, `cd`, `echo`, `printf`, `stat`, `du`, `basename`, `dirname`,
  `realpath`, `which`, joined by `|`, `&&`, `||`, `;`, reading input only via `< file`, with output
  only discarded (`2>/dev/null`) or merged (`2>&1`). Excluded: `rg --pre`, `sort -o`, `uniq in out`,
  `printf -v`, `find -delete/-exec/-execdir/-ok/-fprint*/-fls`, `sed -i/-f` and sed scripts using
  anything beyond addresses, `s///[gpI0-9]` and `p d q n =` (so no `w`, `r`, `e`), `awk -f/-i/-l/-E`
  and awk programs containing `system`, `getline`, `|` or `>`, unexpanded `$VAR` in command
  position, `$(…)`, backticks, file output redirects, multi-line.
- **Build output deletes** are MEDIUM instead of HIGH (still prompt, but can be remembered):
  `rm -r/-f` where every target is a relative `coverage`, `dist`, `out-tsc`, `.angular/cache`,
  `.nyc_output`, `test-results` or `playwright-report` (no globs, `..`, absolute or `~` paths).
  The folder names are part of the remembered risk, so approving `coverage` does not approve `dist`.
- Shows a dialog: **Run** / **Run & remember for this session** / **Abort**
  - "Remember" keys on each stage's command (`rg`, `head`, `git status`, …) plus the exact risk
    reasons shown. Later commands auto-run only if all their commands and all their risks were
    approved together, so approving `cat x | grep y` does not approve `cat x > file`.
  - Not offered for HIGH-risk commands or commands with `$(…)`, backticks or newlines.
  - Cleared on every new session; `/bash-guard rules` lists approvals, `/bash-guard forget` clears them.
- If aborted, the tool call is blocked and the model receives a clear reason
- Remembers recently aborted commands for 60 s to prevent retry loops

### Subagent (`PI_SUBAGENT_DEPTH` ≥ 1) — headless hard-block

Spawned subagents have no UI (stdin is `/dev/null`), so prompting is impossible. Instead,
a focused set of catastrophic/unrecoverable operations is hard-blocked with no user interaction:

| Pattern | Reason |
|---|---|
| `rm -r` / `-rf` / `-Rf` | Recursive deletion |
| `sudo` | Elevated privileges |
| `curl\|sh`, `wget\|sh` | Pipe to shell (remote code execution) |
| `mkfs*`, `newfs_*` | Filesystem formatting |
| `wipefs` | Disk signature wipe |
| `diskutil erase/zeroDisk/secureErase/reformat` | Destructive disk operation |
| `dd of=/dev/…` | Raw disk write |
| `parted`, `fdisk`, `gdisk`, `sgdisk` | Partition table management |
| `cryptsetup` | Disk encryption management |
| `zpool` | ZFS pool management |
| `shutdown`, `reboot`, `halt`, `poweroff` | System power operation |
| `terraform destroy` | Infrastructure teardown |
| `kubectl delete` | Kubernetes resource deletion |
| `aws s3 rm --recursive` | Bulk S3 deletion |
| `git commit` | Main-session operation |
| `git pull` | Main-session operation |
| `git push` | Main-session operation |
| `git reset --hard` | Discard all uncommitted changes |
| `git clean -f` | Delete untracked files |
| `git reflog expire` | Remove recovery history |
| `git gc --prune` | Prune unreachable objects |

All other commands (including routine git operations) pass through unaffected.

## Install

Auto-discovered from `~/.pi/agent/extensions/bash-guard/`. Run `/reload` in pi.

## Notes

- Scope: `bash` tool calls only (`write`/`edit` and user `!` commands are not intercepted).
- `--bash-guard-auto-allow`: main-session flag that allows flagged commands when there is no UI
  (e.g. running pi non-interactively). Has no effect in subagent sessions.
