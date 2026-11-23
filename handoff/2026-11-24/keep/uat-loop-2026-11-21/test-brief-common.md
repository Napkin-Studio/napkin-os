# UAT loop — common brief for Production Tool test agents (2026-11-21)

You are testing the Napkin Production Tool LIVE on UAT. Real money is spent on every generation.

## Where
- UAT: http://napkin-uat-web-126391466.eu-west-1.elb.amazonaws.com
- Sign in: POST /api/auth/sign-in with JSON {"user":"<name>","agency":"<agency>"} (cookie), or in the UI type `<name>@<agency>` into input[placeholder="name@agency"]. Then open /production/ (the Production Tool, same origin; its API is /production/api/...).
- The beta notice ("I understand") may be clicked for mock accounts.
- Code under test: /home/batunii/Documents/Code/napkin-wt-pt-uat (branch fix/pt-uat-loop = develop + relay trace logging), production-tool/web (React) and production-tool/relay (Python, runs as AWS Lambda napkin-hackathon-relay; stitch = napkin-hackathon-stitch).
- Read first: ~/Documents/napkin-local-keep/uat-loop-2026-11-21/dex-audit.md (what "Dex", the director layer, gets and sends; known suspected bugs).

## Tools
- Drive the UI with Playwright (headless Chromium) from /home/batunii/Documents/Code/napkin-wt-pt-uat/app (it has node_modules with @playwright/test; run scripts from inside app/ so modules resolve). Viewport 1440x900 (laptop first). Take screenshots of every step and every result into your output folder.
- NEVER use the Claude in Chrome extension (mcp__claude-in-chrome__*).
- Backend: `export AWS_PROFILE=napkin`.
  - Jobs ledger: DynamoDB napkin-hackathon-jobs (field `body` is the job JSON). Helper: `python3 ~/Documents/napkin-local-keep/uat-loop-2026-11-21/tools/jobs.py <since-UTC> [--full <jobId>]` (fix the helper's cost/timing field names if they're wrong, it was written blind).
  - Logs: CloudWatch /aws/lambda/napkin-hackathon-relay and /aws/lambda/napkin-hackathon-stitch (`aws logs filter-log-events --log-group-name ... --start-time <ms> --filter-pattern '"<jobId>"'`).
  - Outputs: S3 bucket napkin-hackathon-741448934623 (out/, tenants/<tenantId>/projects/...).
- Never print or write API keys or secrets.

## For every generation, record (one JSON line per job in your folder's jobs.jsonl)
op, jobId, what you asked (UI words + refs + settings), what the web sent (capture the POST body via Playwright request interception), what Dex received and produced (job record director.input / director.output, prompt actually sent to the provider, model chosen), timings (click → queued → running → landed in UI; from timestamps + your own clock), cost, outcome, and a QUALITY judgement: look at the output image (Read the downloaded PNG / a frame grabbed with ffmpeg from video) and score 1-5 against the ask, saying concretely what's right/wrong (identity held? composition followed? text artifacts? ref leaks?).

## For every UI control you touch
Record: control, where, expected, actual, works / partly / broken, screenshot path. Try keyboard and undo where offered. Note confusing words, slow states (>2 s with no feedback), dead ends, console errors (page.on('console'), page.on('pageerror')), failed network calls.

## Rules
- Spend: your budget is stated in your task. Name each paid action in your log before you press it. Stop paid actions at your budget; keep testing free things.
- Work only in projects you create, named "UAT-R<round> <your-slug> ...". Never open or modify other projects.
- Don't change code. Don't deploy. Don't restart anything. Report only.
- If a job hangs > 10 min, record it as a bug with its jobId and the last log lines, and move on.

## Report (final message, under ~1500 words) + files
Write ~/Documents/napkin-local-keep/uat-loop-2026-11-21/round-<N>/<your-slug>/report.md with: summary counts (works/partly/broken), BUG list (each: id, severity S1 broken/S2 wrong/S3 rough, steps, expected, actual, evidence paths/jobIds, suspected code location if you looked), Dex findings (got / could get / sent / should send), quality table, timings table, spend total. Your final message: the bug list and the report path.

## Relay trace (new this round)
Each job now logs JSON lines on the relay log group with "jobId": evt=provider_submit (full promptText, refs, model, taskId), evt=job_stage (stage queued/submitted/provider_done/fetched/landed/failed… with ms and totalMs), evt=director (Dex latency/usage), evt=director_rejected (Dex answer rejected → passthrough). Use them: `aws logs filter-log-events --log-group-name /aws/lambda/napkin-hackathon-relay --start-time <ms> --filter-pattern '"<jobId>"' --query 'events[].message' --output text`.
If these lines are missing for a job, that is a bug.
