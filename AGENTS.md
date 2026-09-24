# AGENTS.md

<!-- ai-rulebook:start -->
<!-- Managed by the AI Rulebook extension. Text between the ai-rulebook markers is regenerated on install; toggle rules from the AI Rulebook sidebar instead of editing here. -->

<!-- ai-rulebook:rule code enabled -->

## Code

- Before adding a helper, search for an existing one. Reuse or extend rather than adding a near-duplicate.
- Place new code with the feature it belongs to. Use established module boundaries and public entry points where they exist.
- Prefer the standard library or an already-present dependency over adding a new one; flag any new dependency in your report.
- Before adding a dependency, check maintenance status, runtime compatibility, and known security issues. Do not add prerelease, archived, or deprecated dependencies, dependencies with known unmitigated vulnerabilities, or ones requiring an EOL runtime. Treat release age as a reason to investigate, not proof of abandonment. Flag existing dependency issues encountered in the task; don't migrate them unasked.
- Validate input that crosses a trust boundary (user input, network, files, environment). Never log or commit secrets. Add actionable context when propagating errors across boundaries; preserve the original cause. Do not silently discard failures.

<!-- ai-rulebook:end-rule code -->

<!-- ai-rulebook:rule docs enabled -->

## Docs

- Update existing documentation when the change makes it inaccurate, including usage, configuration, requirements, architecture, and development commands.
- Follow the project's documentation layout and conventions. If none exist, keep platform-read files at the root and other documentation under `docs/`, linked from `README.md`.
- Add user-facing release notes for release-worthy changes. Follow the existing changelog format; describe visible behavior and skip internal refactors.
- Create new documentation only when requested or necessary to explain the changed behavior. Do not introduce a new documentation framework without being asked.

<!-- ai-rulebook:end-rule docs -->

<!-- ai-rulebook:rule git enabled -->

## Git

- Inspect the working tree before editing. Preserve changes you did not make.
- Don't commit, push, or create branches unless asked.
- When asked to commit, stage only your task's changes, using selective hunks
  where files contain unrelated edits — never a blind `git add -A`. Inspect
  the staged diff before committing. Write an imperative subject line with
  a body that says why.
- Never force-push, rebase, amend, or reset away pushed history unless the
  user explicitly names that operation.

<!-- ai-rulebook:end-rule git -->

<!-- ai-rulebook:rule markdown enabled -->

## Markdown

When editing `.md` files:

- One H1; never skip heading levels.
- `-` for bullets; language tag on every fence.
- Inline code for paths, commands, and filenames.
- Relative links for in-repo targets.

<!-- ai-rulebook:end-rule markdown -->

<!-- ai-rulebook:rule scope enabled -->

## Scope

- Before editing, inspect the relevant implementation, tests, and project commands. Identify the requested outcome, make the smallest complete change, and verify it. Continue until complete or blocked by a concrete dependency.
- Resolve routine, reversible implementation choices using project conventions. Ask when ambiguity materially changes behavior, scope, compatibility, or an irreversible action.
- Change only what the task requires. No drive-by refactors, renames, reformatting, or version bumps.
- Tests and documentation for the change itself are part of the task, never drive-by work.
- Follow local naming, formatting, and structural conventions. Conventions do not override safety, correctness, or verification requirements.
- If a rule implies work outside the task, state it and move on — don't act on it.
- An unrelated bug or dead code you notice gets reported, not fixed.

<!-- ai-rulebook:end-rule scope -->

<!-- ai-rulebook:rule tests enabled -->

## Tests

- For behavior changes, add or update a test at the level that exercises the requirement. For bug fixes, first reproduce the failure with a regression test when feasible. Test observable behavior rather than implementation details.
- Match the project's existing test file location and naming convention. If none exists, colocate tests with the source using the ecosystem's standard suffix (e.g. `foo.test.ts`, `foo_test.go`).
- After behavior changes, run the project's test command.
- Run the project's existing lint and type checks before reporting done; fix what you introduced. If no linter is configured, recommend one suited to the project and explain its benefit. Add or configure it only when requested or approved. Never disable lint checks merely to obtain a pass.
- Do not weaken checks merely to obtain a pass. When a requirement intentionally changes, update obsolete expectations and explain the change. Preserve coverage of behavior that remains required.
- Before reporting completion, inspect the final diff for unintended changes, debug code, secrets, and missing generated artifacts.
- State what changed, which checks ran and their results, and any remaining blockers. Report every failing test and every relevant check not run. Distinguish observed results from assumptions; never describe an unrun test as passing.

<!-- ai-rulebook:end-rule tests -->
<!-- ai-rulebook:end -->

<!-- ai-rulebook:subagent-mode:start -->

<!-- Managed by the AI Rulebook extension: token-efficient subagent mode. Regenerated by the enable command; run the disable command to remove it. -->

## Token-efficient subagent mode

Apply this section only when your tool can delegate work to subagents.
Otherwise skip it and work normally.

Keep the session model for judgment only: reading the request, planning,
writing specs, resolving blocks, and the final report. Delegate searching,
editing, and check runs to subagents on cheaper models.

### Model tiers

Choose each subagent's model by tier from what your vendor offers, and set
it on the spawn call when the tool allows it (in Claude Code, pass `model`
on the Agent call):

| Tier | Work | Typical model |
| --- | --- | --- |
| fast | searching, running checks | the smallest current model (Claude Haiku, a GPT mini-class model, Gemini Flash) |
| standard | applying specified edits | the mid-priced coding model (Claude Sonnet, the default GPT coding model) |
| deep | reviewing high-risk diffs | the strongest model, at high reasoning effort (Claude Opus) |

A model counts as unavailable when it is not offered, is blocked by policy,
fails to start, or is rate-limited. Substitute in this order, tell the user
once which substitute you chose, and keep it for the rest of the session
instead of retrying the missing model:

- fast: use standard, then the session model.
- standard: use the session model. Use fast only for a literal
  find-and-replace edit.
- deep: use the session model when it is at least standard tier, otherwise
  standard at its highest reasoning effort.

Never substitute a model more expensive than the session model. When the
tool cannot set a model per subagent, still delegate: keeping file contents
and command output out of the session context is the larger saving.

### Workflow

- Scale to the task. A change you can already see in one file you have
  read: make it yourself, no subagents. Anything that needs searching,
  touches more than one file, or needs a check run: orchestrate.
- Search with a read-only search subagent on the fast tier. Ask for the
  conclusion plus `path:line` pointers, never file contents. Read a file
  yourself only when you will edit it or judge it.
- Edit with an implementer on the standard tier. One call is one file, one
  function, one concern. The spec names the file, the function, the exact
  change, and the check command, so the delegate never searches. Spawn
  independent edits in parallel; sequence only dependent ones.
- Run checks with a test runner on the fast tier. Name the exact command
  and the narrowest scope that covers the change; the default is
  `npm test`. Never run a slow suite to be safe.
- Review once, at the end: after the checks pass and before the final
  report, give a read-only reviewer on the deep tier the whole diff. Do this
  only for concurrency, security, auth, credential, persistence, or
  migration diffs. Judge each finding yourself, make small fixes yourself,
  and re-run the affected check.
- When a delegate's edit is wrong or its check fails, fix it yourself
  instead of spawning another delegate; you already hold the failing output.
  Resend a corrected spec once after a `BLOCKED:` reply, then do the work
  yourself. Never spawn a third delegate for the same change.
- Pass paths and line ranges, not pasted file bodies, diffs, or tool output,
  when the delegate can read them itself.
- Trust results while the work is in progress. A passing check is not
  re-run, a `NO FINDINGS` review is not re-reviewed, and a reported change is
  not re-read unless its check failed.
- Before the final report, read the final diff once yourself. You answer for
  the result, not the delegates.
- Skip multi-agent fan-out beyond this unless the user asks for it.

### Delegate contracts

State the matching contract in each spawn prompt:

- Implementer: apply only the specified edit, with no drive-by changes and
  no git commands. Run the named check. Reply with the changed `path:lines`
  and `PASS` or `FAIL` plus the failing block, at most 60 lines. If the spec
  is incomplete or does not match the file, reply `BLOCKED:` with the one
  question that unblocks you instead of guessing or searching.
- Test runner: run exactly the named command in the foreground and edit
  nothing. Reply `PASS` or `FAIL` with only the failing tests' output, at
  most 60 lines each. Never diagnose, fix, or retry.
- Reviewer: read the diff and its callers and edit nothing. Reply with
  verified findings ranked by severity, each with `path:line`, the concrete
  failure scenario, and a one-line fix, or exactly `NO FINDINGS`. Skip style
  and anything a linter reports.

A `BLOCKED:` reply means the spec was wrong or incomplete. Read the code
yourself and rewrite the spec before the one resend. Never retry verbatim.

<!-- ai-rulebook:subagent-mode:end -->
