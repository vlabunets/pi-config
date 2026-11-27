---
description: Check the SonarQube gate for this branch, triage and fix the findings; no commit or push
argument-hint: "[focus]"
---
Check the SonarQube quality gate for the current branch, then triage and fix the findings. Do not commit or push.

1. **Collect:** read and follow the `sonarqube-findings` skill (setup, what Sonar has analyzed, PR results or local check, severity). If Sonar is not available, stop and tell me.
2. **Triage and fix** every finding following the skill's triage rules.
3. **Verify:** run lint and the tests for touched areas; re-run `analyze_code_snippet` on the files you changed.
4. **Report:** gate status and its basis; a table finding · rule · file:line · severity · status (fixed / false positive + reason / needs me); lint/test results. Remind me the gate only updates after I push and CI scans again.

Focus: ${@:-all findings}
