---
name: sonarqube-findings
description: "Collect SonarQube Cloud findings for the current branch through the sonarqube MCP server: quality gate, issues, security hotspots, coverage and duplication, or a local analyze_code_snippet check when Sonar has not analyzed the changes. Includes severity mapping and triage rules. Use when checking the Sonar quality gate, before opening a PR, or when asked for Sonar issues, hotspots or coverage on a branch or PR."
---

# SonarQube findings for the current branch

Procedure to collect, classify and triage SonarQube findings. The calling task decides what to do with them (fix, report, hand to a review loop). The connection is **read-only**: never try to change anything in SonarCloud.

## 1. Setup

- Read `sonar.projectKey` (and `sonar.exclusions`) from `sonar-project.properties`. If the file is missing or the `sonarqube` MCP server is not connected, say so and stop this procedure. The caller decides whether to continue without Sonar.
- Pass the key to every tool that accepts `projectKey`/`projectKeys`. Without it, issue search covers the whole SonarCloud organization.
- Tools with no project parameter (`list_pull_requests`, `search_duplicated_files`, `search_files_by_coverage`, `get_file_coverage_details`, `get_component_measures`) only read the project configured on the `sonarqube` MCP server (`SONARQUBE_PROJECT_KEY`, named in the server description). If `sonar.projectKey` is a different project, do not use them.

## 2. Decide what Sonar has analyzed

Run `gh pr view --json number,headRefOid,statusCheckRollup`. Sonar only scans PRs and pushes to master/test.

| Situation | Meaning | Next |
|---|---|---|
| `SonarCloud Code Analysis` check completed on the PR head | Analyzed | Step 3. If local HEAD or the working tree is newer than the PR head, say the results don't cover those changes and also run step 4 on them. |
| PR exists, check missing or pending | **Not analyzed.** A 404 or an empty issue list is never a pass. | If the `build-and-analyze` job failed, read `gh run view <run-id> --log-failed`: a failed build or test step skips the scan and is itself a HIGH finding. Step 4. |
| No PR | Not analyzed | Step 4. |

## 3. Read the PR results

Set `pullRequest` to the PR number **as a string**.

- `get_project_quality_gate_status`: status and every condition. Use the thresholds it returns; they vary by PR.
- `search_sonar_issues_in_projects` with `issueStatuses: ["OPEN", "CONFIRMED"]`, reading all pages.
- `search_security_hotspots` with `status: "TO_REVIEW"`.
- Failing coverage condition: `search_files_by_coverage`, then `get_file_coverage_details`.
- Failing duplication condition: `search_duplicated_files`, then `get_duplications`.

## 4. Local check (changes Sonar has not analyzed)

- Run `analyze_code_snippet` with the full content of each changed file and its `language`. Use `scope: "TEST"` for `*.spec.ts`. Skip files matching `sonar.exclusions`.
- Keep only issues on lines changed since the base branch. Call the rest pre-existing.
- This is single-file only: no gate, coverage or duplication result. Report the gate as **"not evaluated"**, never as passed.
- After fixing code, re-run it on the files you changed.

## 5. Severity

| Sonar | Severity |
|---|---|
| Fails the gate, BLOCKER, CRITICAL, failed build/test before the scan | HIGH |
| MAJOR | MEDIUM |
| MINOR, INFO | LOW |

## 6. Triage rules

- Check every finding against the code before fixing or dismissing it. A dismissal needs a one-line reason.
- Fix order: gate failures, then HIGH, MEDIUM, then LOW unless clearly noise.
- Coverage: add meaningful tests for the uncovered new lines, not tests that only execute code.
- Hotspots: fix the code if the risk is real. Otherwise list it for the user, because a person must mark hotspots as reviewed and issues as false positive in SonarCloud.

## 7. What to state in the report

- Gate status and its basis: PR number and analyzed commit, or "local check only".
- Each finding with rule, file:line and severity.
- The gate itself only updates after a push and a new CI scan.
