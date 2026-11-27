---
description: Review the branch with 2 models plus SonarQube findings, fix, re-review (max 3 rounds); no commit or push
argument-hint: "[what the change should do]"
---
Before I open the PR, run a review loop on the current branch. Do not commit or push.

1. **Base:** run `git-base-branch` (it explains its choice on stderr), tell me which branch it picked, then `git fetch origin <base>`.
2. **Sonar findings:** collect them yourself with the `sonarqube-findings` skill; reviewers cannot reach the MCP server. If Sonar is not available, say so and continue without it.
3. **Round 1:** spawn two `reviewer` subagents in parallel: `review-mai` (`github-copilot/mai-code-2-flash`) and `review-gpt` (`github-copilot/gpt-6.1-terra`). Give each the repo path, the base branch and 2–3 sentences on what the change should do. Do not give them the Sonar findings.
4. **Verify:** merge and de-duplicate reviewer and Sonar findings, check each against the code, and reject false positives with a one-line reason.
5. **Fix** verified HIGH and MEDIUM, and LOW unless clearly noise (Sonar items per the skill's triage rules). Run lint and the tests for touched areas.
6. **Next round:** `analyze_code_snippet` on the files you changed, plus ONE fresh `reviewer` (alternate the model, never reuse one) on the full branch diff, told which areas were just fixed. Repeat 4–6 until a round has no verified HIGH or MEDIUM, max 3 rounds.
7. **Report:** Sonar gate status and its basis; a table finding · source (reviewer / Sonar rule) · severity · round · status (fixed / rejected + reason / needs me); lint/test results. Remind me the gate only updates after I push and CI scans again.

What the change should do (for the reviewers): ${@:-summarise it yourself from the branch commits and diff}
