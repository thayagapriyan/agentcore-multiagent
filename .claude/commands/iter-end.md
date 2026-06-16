---
description: Finalize the current iteration — verify prompt log, append CHANGELOG, draft commit
allowed-tools: Bash, Read, Edit, Write
---

Finalize the current iteration.

## Steps (do these in order)

1. **Determine current iteration.**
   - Run `git rev-parse --abbrev-ref HEAD` to get the branch name.
   - Parse `feat/iter-<N>-<slug>`. If the branch doesn't match (e.g. work landed on
     `main`), infer `N` from the most recent `iter-N:` commits and confirm with the user.

2. **Verify the prompt log is complete.** Open `docs/prompts/iter-<N>.md`. Check that every section has real content (not placeholder text):
   - Goal
   - Prompts used (at least one prompt logged)
   - Decisions made (or explicitly marked "none")
   - Files created / modified (with real file paths)
   - Tests — **every checkbox must have an actual command and actual output**, not `<...>` placeholders (an intentional "pending pipeline" item left unchecked is fine)
   - Forward-compatibility check
   - Rollback

   If anything is empty or still has placeholders, list what's missing and stop. Do not proceed until the user fills them in.

3. **Append a CHANGELOG entry.** Add to [CHANGELOG.md](../../CHANGELOG.md), at the **bottom of the iteration list** (never edit a past entry), using this project's established format:

   ```markdown
   ## [Iter <N>] — YYYY-MM-DD — <title>

   - Added / Changed / Removed: <files or features, concise>
   - Context: <why this iteration exists, one paragraph>
   - Tests: <actual commands → actual results>
   - Prompt log: [docs/prompts/iter-<N>.md](docs/prompts/iter-<N>.md)
   - Rollback: <how to undo — terraform destroy -target / env-flag flip / revert>
   - Forward-compatibility: <one line>
   ```

   Keep the `---` separator and the convention footer at the bottom intact. Pull all content from `docs/prompts/iter-<N>.md` — do not invent anything.

4. **Update the iteration-plan tracking checklist.** In [docs/iteration-plan.md](../../docs/iteration-plan.md), tick `- [x] Iter <N> …` in the "Tracking progress" block.

5. **Stage the changes.** Run `git status` and show the user. Stage only the iteration's intended files (do not blanket `git add -A`).

6. **Draft the commit message** in the required format:

   ```
   iter-<N>: <title>

   Prompts: docs/prompts/iter-<N>.md
   Iteration: <N>
   Tests: <one-line summary>
   ```

   Show the message to the user and **wait for explicit confirmation** before running `git commit`.

7. **After commit, do NOT push.** Print a reminder: "Push when ready with `git push -u origin feat/iter-<N>-<slug>`."

## Reminders (from CLAUDE.md)

- Never edit a past CHANGELOG entry. Append follow-ups instead.
- No `--no-verify`, no `--force`, no `--amend` unless the user explicitly asks.
- Don't run `git commit` / `git push` without confirming with the user.
- Commit messages use a single-quoted here-string for multi-line bodies on PowerShell
  (closing `'@` at column 0):
  ```powershell
  git commit -m @'
  iter-<N>: <title>

  Prompts: docs/prompts/iter-<N>.md
  Iteration: <N>
  Tests: ...
  '@
  ```
