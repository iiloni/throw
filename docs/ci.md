# Pull requests and CI

Throw's [CI workflow](../.github/workflows/ci.yml) separates PR iteration from full
validation. Every PR update targeting `main` runs lint, type checks, unit tests and builds.
The `run e2e` label requests the full suite on a draft without merge approval. The
`merge on pass` label means functionality and design are approved and the agent may
merge once all required checks pass. Either label requests the Docker-backed test suite: a
desktop run, a mobile run, the API tests and the unit tests run beside a real Postgres. Mobile
E2E emulates Android in Chromium; it does not test a native APK.

The required check is **`validation`**. For a PR, it fails until `merge on pass` is present
and checks and both E2E projects succeed in the same run. A PR with only `run e2e` still
has a failing `validation` check after successful E2E, with a message that approval is
required. A PR with neither label also has a failing `validation` check; its ordinary
`check` job still reports whether development checks passed. Skipped E2E jobs do not satisfy
the gate. Main pushes and manual CI requests request the full suite. There is no release
workflow yet; the reuse of a verified full pass for an exact commit
(`scripts/wait-for-ci.ts`) is kept from Catch for when there is.

A change confined to documentation is the exception: it runs `check` and skips E2E, on
its PR and on the push to `main` that follows. See
[Documentation-only changes](#documentation-only-changes).

Optional [AI code review](ai-reviews.md) is requested separately with the `ai review`
label. It can run while a PR is a draft, is advisory, and does not authorize merging.
Agents recommend a review for higher-risk changes and wait for explicit developer
approval before adding the label (see `AGENTS.md`).
Wait for requested feedback and address useful findings before merge approval.
The AI request job and cubic's review are not part of the required `validation` check.

## GitHub repository setup

Throw is public and uses the same repository settings and default-branch ruleset as
Catch. The setup below was verified on 2026-10-13.

- The active **PR Checks** ruleset targets the default branch (`main`), requires a PR
  and the **`validation`** status check, and allows only squash merges into it.
- There are no bypass actors, including repository admins. Force pushes and deletion
  of the default branch are blocked.
- Required approving reviews are zero, and branches need not be up to date before
  merging (see [What gets merged](#what-gets-merged)).
- Repository-wide merge, squash and rebase methods are available, as in Catch; the
  ruleset restricts merges into `main` to squash.
- **Allow auto-merge** and **Automatically delete head branches** are enabled.
  Auto-merge availability does not enable it on individual PRs. The `merge on pass`
  label authorizes merging after validation; the workflow itself never merges.
  Agents normally squash-merge manually after checking intervening changes on `main`.
- Actions are enabled with all actions allowed, read-only default token permissions,
  and permission for Actions to create or approve PRs disabled. Individual workflows
  declare the permissions they need. Workflow runs from first-time fork contributors
  require approval.

To inspect or recreate the protection, open **Settings → Rules → Rulesets → PR Checks**.
Keep enforcement **Active**, target the default branch, leave the bypass list empty,
require pull requests with squash as the only merge method and zero approving reviews,
require `validation`, and block force pushes and deletions. Leave **Require branches
to be up to date before merging** off.

`validation` covers `check`, `e2e (desktop)` and `e2e (android)`. Requiring only E2E jobs
is insufficient because GitHub accepts conditionally skipped jobs as successful checks.
See [required-check behavior](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
and [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets).
Rulesets and auto-merge are available for public repositories on GitHub Free; keeping
Throw private while enforcing this protection would require GitHub Pro.

The `merge on pass`, `run e2e` and `ai review` labels already exist. If recreating the
repository, create them before using the workflows:

```bash
gh label create "merge on pass" --color 1D76DB --description "Functionality and design approved; merge when required checks pass"
gh label create "run e2e" --color FBCA04 --description "Run full E2E on GitHub; does not authorize merging"
gh label create "ai review" --color 1D76DB --description "Request an advisory cubic review; does not authorize merging"
```

For a solo maintainer, leave required approving reviews disabled unless someone else can
review: GitHub does not let a PR author approve their own PR. Draft status keeps a PR from
merging while its functionality is still being reviewed.

The workflow needs no new repository secrets or broad write permissions. An agent using
the CLI needs its own authenticated GitHub account/token with permission to push branches
and edit PRs. Actions' `GITHUB_TOKEN` does not trigger label workflows when it applies a
label; use the agent's normal GitHub login (or a separately configured GitHub App/PAT) for
that action. See [workflow token behavior](https://docs.github.com/en/actions/concepts/security/github_token).

## Everyday workflow

Agents follow this process by default for new features and code fixes, as specified in
[the agent guide](../AGENTS.md). Request the feature normally; the agent commits and pushes
reviewable changes and opens a draft PR assigned to its creator (`--assignee @me` when
using `gh pr create`). After reviewing functionality and design, apply
`merge on pass` yourself or tell the agent the feature is approved for merging after tests
pass. The agent then monitors checks for the latest commit, investigates and fixes
failures, pushes updates and continues until it verifies the authorized PR is merged.
Opening a PR or enabling auto-merge alone does not finish the task.

Agents add existing descriptive labels while opening a draft, using a small set that
matches the change:

| Label | Use for |
| --- | --- |
| `enhancement` | New features or improvements |
| `bug` | Fixing defects |
| `documentation` | Substantive documentation changes |
| `accessibility` | Accessibility improvements or fixes |
| `maintenance` | CI, build tooling, dependencies, refactoring or test infrastructure |

These labels describe scope. `run e2e` requests tests; `merge on pass` records approval
and merge authorization and also requests tests.
Set descriptive labels before requesting full validation, since later label edits also
trigger CI. Ordinary PR work does not require inventing new labels or adding unrelated
labels such as `duplicate`, `invalid` or `wontfix`.

1. Work on a branch and open a draft PR targeting `main`. Push iterations while reviewing
   functionality and design. Use targeted local E2E for affected specs or cases, with
   `--workers=1` to reduce contention across worktrees:

   ```bash
   ./scripts/dev.sh e2e e2e/projects.spec.ts --grep 'create' --workers=1
   ```

   Leave `merge on pass` absent. For sweeping changes that benefit from broad regression
   coverage (shared navigation, sync or test infrastructure, for example), agents may
   request the full GitHub suite before approval:

   ```bash
   gh pr edit <number> --add-label 'run e2e'
   ```

   Keep the PR a draft. This label grants no permission to merge or enable auto-merge.
   Adding it starts full E2E; later pushes rerun the suite while it remains. After the
   requested E2E jobs finish, inspect their results and remove the label if upcoming
   commits do not need another full run:

   ```bash
   gh pr edit <number> --remove-label 'run e2e'
   ```

   Keep it while fixing E2E failures or iterating on sweeping changes that still warrant
   full coverage. Reapply it when another full run is justified. Wait until the run
   finishes before removing it, since label changes cancel superseded CI runs. Removing
   it triggers ordinary checks and skips E2E when `merge on pass` is absent.
   Ordinary changes use targeted local tests
   and rely on the mandatory full suite before merge; do not run full local E2E as a
   routine finishing check. An explicit user request can also justify an early full run.
2. Once functionality and design are approved for merging after tests pass, mark the PR
   ready and add `merge on pass` (for a documentation-only change this runs no E2E):

   ```bash
   gh pr ready <number>
   gh pr edit <number> --add-label "merge on pass"
   gh pr checks <number> --watch
   ```

3. Keep the label while fixing test failures. Each subsequent commit reruns checks and
   E2E. New PR events cancel older runs, including older label state. Download screenshots
   and retry traces from the failed workflow's artifacts to investigate. A flaky Playwright
   retry still fails CI, matching the local configuration.
   If fixing a failure changes approved functionality or design, disable pending auto-merge,
   return the PR to draft, remove `merge on pass` and obtain renewed approval before
   reapplying it.
4. When `validation` passes, check what reached `main` since the branch last included
   it, then merge:

   ```bash
   git fetch origin main
   git diff --stat HEAD...origin/main
   gh pr merge <number> --squash
   ```

   A branch behind `main` still merges, and every update reruns the full suite, so leave
   the branch alone when the new commits touch neither the files nor the behavior the PR
   changes. When they do, or the branch conflicts, merge `main` into the branch, review
   how the two changes combine, fix what does not fit, run targeted checks and push, then
   wait for validation again. Auto-merge skips this look; enable it only when nothing
   else is close to merging. Use a Conventional Commit title for a squash merge.

To return to feature iteration, disable any pending auto-merge, make the PR a draft and
remove `merge on pass`. Removing the label withdraws merge authorization and triggers a
new run that fails the gate. E2E continues if `run e2e` remains; remove both labels to
stop requesting the full suite.
To rerun full E2E for the same commit, use **Re-run all jobs** on the latest CI run that
requested E2E, or remove and reapply `run e2e`. Full merge validation also requires
`merge on pass`. Rerunning an older unlabeled event uses
that event's original label state. Label changes trigger CI, so unrelated label edits can
also rerun E2E while either test-requesting label is present.

## Targeted Firefox testing

The default local and CI projects use Chromium for desktop and Android emulation, plus
the API project. Firefox is an opt-in desktop project: agents run the affected cases for
navigation/transitions, scrolling and fixed/sticky layers, focus/keyboard management,
browser API support, and bugs reported in Firefox or a Firefox-based browser such as Zen.
Other features do not need another browser run or a second full suite.

Install the Playwright browser once on the host, then use the same worktree stack and
test queue:

```bash
pnpm exec playwright install firefox
E2E_FIREFOX=1 ./scripts/dev.sh e2e e2e/projects.spec.ts --project=firefox --workers=1
```

The environment variable makes the project available; `--project=firefox` selects it
without rerunning the Chromium projects. Leaving the variable unset preserves the default
project list. This adds no Firefox jobs to CI. Record the actual browser version tested;
Playwright's Firefox build can differ from the reported Firefox/Zen version, and desktop
Firefox does not establish coverage for Android Firefox or a native APK.

For visual bugs, check painted frames before, during and after the interaction. Computed
styles or DOM visibility alone do not prove that a capture is painted. Firefox's screenshot
API can [omit active view transitions](https://bugzilla.mozilla.org/show_bug.cgi?id=2008417).
For those transitions, run headed Firefox on an isolated virtual display (for example,
Xvfb on Linux) and capture that display with FFmpeg's `x11grab`, keeping recordings outside
the checkout. Continue to run the test through `./scripts/dev.sh e2e`; capture only the
isolated test display. Ordinary screenshots remain useful outside a view transition.

### Firefox baseline

Throw has no recorded Firefox baseline yet. Catch's test counts, failing specs and
issue references do not establish a baseline for Throw. Confirm a failure on the
unchanged base revision with the same browser and targeted cases before treating it as
pre-existing. Record the commit, actual browser version, tested cases and results when
establishing a Throw baseline.

## Documentation-only changes

A change needs no E2E when every file it touches is one the app, its image and its tests
never load. [`scripts/change-scope.ts`](../scripts/change-scope.ts) holds the list:

- `docs/**`
- Markdown in the repository root (`README.md`, `AGENTS.md`, `DEVELOPMENT.md`, ...)
- `.github/pull_request_template.md`, `LICENSE`, `.gitignore` and `cubic.yaml`

Everything else counts as code, including Markdown anywhere else (a fixture is test
input), workflows, scripts and the files CI itself runs from. A change that mixes the
two is code. A renamed file counts under both its old and its new path, and a change the
workflow cannot read counts as code. Add a path to the list only when nothing that runs
reads it.

For such a change:

- `check` still runs: lint, type checks, unit tests and builds.
- `merge on pass` does not start E2E, and `validation` passes on `check` alone. The label
  is still required, because it records approval, so an unlabeled documentation PR fails
  `validation` like any other.
- `run e2e` still starts the full suite, and `validation` then waits for it.
- The push to `main` skips E2E as well. That run is green without being a full pass.
  Manual CI requests and merge groups always run everything.

The change is read from GitHub's merge commit for a PR (against its base) and from the
pushed range for `main`, so a PR is judged on everything it changes, not its last commit.

## What gets merged

PR checkout uses GitHub's temporary merge commit, combining the PR branch with its base.
Conflicting PRs need their conflicts resolved and another push before PR CI can run.

A branch does not have to be up to date with `main` to merge. Requiring that made every
merge invalidate the passing result of every other approved PR, so several ready PRs
each waited for a rebase and another full suite per merge ahead of them. A PR's result
therefore covers `main` as it stood when its run started, and two PRs that each pass can
still break `main` together. The agent's look at what landed since (step 4 above) is
there for the changes that overlap; the full suite on every `main` push catches the rest
after the merge.

A red `main` only blocks releasing that commit. Agents finish with their own PR merged
and do not watch `main` afterwards; when `main` needs to be green again, the maintainer
starts an agent for that. An agent whose PR fails on something that also fails on `main`
reports it rather than fixing it in that PR.

The workflow also handles `merge_group: checks_requested`: every merge group runs full
validation without needing a PR label. If the repository later adopts a merge queue,
enable it in GitHub's branch settings; queue availability depends on the repository and
GitHub plan. The queue tests the proposed combination with current `main` and preceding
queued PRs. See [merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).

Local work still must pass `./scripts/dev.sh check` before finishing. Local E2E should be
targeted; full E2E runs on GitHub through `run e2e` when early coverage is justified,
or through `merge on pass` before merging.
