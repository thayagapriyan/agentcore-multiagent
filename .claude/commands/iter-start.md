---
description: Scaffold a new iteration — creates branch, copies prompt-log template, summarizes plan
argument-hint: <iter-number> "<title>"
allowed-tools: Bash, Read, Write, Edit
---

Start a new iteration. Arguments: **$ARGUMENTS**

Parse the arguments:
- First token = iteration number `N` (may be `8a`, `8b`, etc.)
- Remainder = `<title>` (often quoted)
- Compute `<slug>` = kebab-case of title (lowercase, spaces → `-`, strip punctuation)

## Steps (do these in order)

1. **Verify clean tree.** Run `git status`. If there are uncommitted changes, stop and ask the user how to proceed.

2. **Re-read the iteration plan.** Open [docs/iteration-plan.md](../../docs/iteration-plan.md) and find Iteration `N`. Read its Design / Develop / Test / Deploy / Rollback / Forward-compatibility blocks.

3. **Create the branch.**
   ```powershell
   git checkout -b feat/iter-<N>-<slug>
   ```
   If a branch already exists, confirm with the user before overwriting.

4. **Scaffold the prompt log.** Copy [docs/prompts/_template.md](../../docs/prompts/_template.md) to `docs/prompts/iter-<N>.md`. Replace placeholders:
   - `Iter N` → `Iter <N>`
   - `<Title>` → `<title>`
   - `YYYY-MM-DD` → today's date
   - `feat/iter-N-<slug>` → actual branch name
   - Fill the **Goal** section using the iteration plan summary.

5. **Summarize the work.** Print a concise list of what the iteration plan says to do (Design → Develop → Test → Deploy steps for this N). Do NOT start any code yet.

6. **Wait for the user's go-ahead** before writing any code or running anything beyond steps 1–5.

## Reminders (from CLAUDE.md)

- Additive only. Forward-compatible. Always green. Reversible. One concern per iteration.
- New agents add a new `agents/<type>/` folder + one `module` block; never modify an existing agent.
- Do NOT update `CHANGELOG.md` now — that happens at `/iter-end`.
- Do NOT commit anything yet.
- Use real test results in the prompt log later, not placeholders.
- Don't run `terraform apply/destroy`, `docker push`, `git push`, or `git commit` without confirming with the user.
