# pkg-ownership GitHub Action — Design

## Overview

A GitHub Action that enforces cross-team awareness in monorepo PRs. When a PR touches files owned by a team the PR author does not belong to, the action upserts a comment per affected team, mentioning team members and warning about the cross-team boundary. One comment per team, updated on every push so the PR thread stays clean.

---

## `.ownership` file syntax

Lives at repo root (path configurable via action input). Plain text, line-by-line state machine — no parsing dependencies.

```
team: payments
+alice
+bob

=ownership:
packages/payments/**
packages/billing/**
!packages/billing/shared/**

=template:
<!-- ownership-bot: {team} -->
:warning: @{members} — `{pkg}` belongs to your team. @{author} is crossing a team boundary, please align first.

team: platform
+carol

=ownership:
packages/platform/**
```

### Syntax rules

| Line | Meaning |
|------|---------|
| `team: <name>` | Starts a new team block |
| `+<github-login>` | Adds a member to the current team |
| `=ownership:` | Switches to pattern mode for the current team |
| bare line in pattern mode | Include glob pattern |
| `!<pattern>` in pattern mode | Exclude glob pattern |
| `=template:` | Everything below (until next `team:` or EOF) is the comment template |
| blank line | Ignored everywhere |

### Template variables

| Variable | Value |
|----------|-------|
| `{team}` | Team name |
| `{members}` | All team member logins rendered as `@alice @bob` |
| `{author}` | PR author login |
| `{pkg}` | Comma-separated list of all matched pattern roots (e.g. `packages/payments, packages/billing`) |

The hidden HTML comment `<!-- ownership-bot: {team} -->` **must** be present in the template — it is the upsert marker used to find and update the comment on subsequent pushes.

If a team has no `=template:` section, a default template is used:
```
<!-- ownership-bot: {team} -->
:warning: @{members} — changes detected in `{pkg}`, owned by **{team}**. @{author}, please align with the team before merging.
```

### Shared files

If a changed file matches no team's patterns, it is considered a shared package. The action exits 0 silently — no comment is posted. Approval requirements for shared packages are handled externally (e.g. GitHub rulesets).

### Future extension: tool integration

Reserved `{tool_output}` template variable. In a future version, teams will be able to define a `=tool:` section with a shell command. If the tool exits 1, its stdout is injected as `{tool_output}` into the template. If it exits 0, the team is skipped as if the author were a member.

---

## Action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | yes | — | GitHub token (`${{ secrets.GITHUB_TOKEN }}`) |
| `ownership-file` | no | `.ownership` | Path to the ownership file relative to repo root |

## Action triggers

```yaml
on:
  pull_request:
    types: [opened, synchronize, ready_for_review]
```

---

## Architecture

Four modules, all CommonJS, no circular dependencies.

```
src/
  parse.js     — parses .ownership text → Team[]
  match.js     — matches changed files against Team[] → MatchResult[]
  comments.js  — upserts PR comments via Octokit
  index.js     — orchestration, reads inputs, calls modules in sequence
```

### `src/parse.js`

Line-by-line state machine. State: `{ currentTeam, section }` where `section` is one of `members | ownership | template`. Returns:

```js
[
  {
    name: 'payments',
    members: ['alice', 'bob'],
    includePatterns: ['packages/payments/**', 'packages/billing/**'],
    excludePatterns: ['packages/billing/shared/**'],
    template: '...'
  }
]
```

### `src/match.js`

For each team:
1. Filter changed files through `minimatch` include patterns
2. Remove any files matching exclude patterns
3. If no files remain → skip team
4. Derive `pkg` from the first matching include pattern: strip trailing `/**`, `/*`, etc.

Returns:
```js
[{ team: Team, pkgs: ['packages/payments', 'packages/billing'] }]
```

### `src/comments.js`

Single exported function:

```js
upsertComment(octokit, { owner, repo, prNumber, marker, body })
```

Lists all issue comments on the PR, finds the first one whose body contains `marker`, updates it if found, creates a new one otherwise.

### `src/index.js`

Orchestration flow:

1. Read `token` and `ownership-file` inputs
2. Parse `.ownership` → `Team[]`; fail action if file is missing or unparseable
3. Fetch changed files for the PR via `octokit.rest.pulls.listFiles`
4. Get PR author login
5. For each team in match results:
   - Skip if PR author is a team member
   - Render template (substitute variables)
   - Call `upsertComment`
6. If no teams matched any files → `core.info('No ownership matches — exiting.')`, exit 0

---

## Build

Add `minimatch` and `@vercel/ncc` (dev) to `package.json` before building.

```bash
npm install
npm run build   # runs: ncc build src/index.js -o dist
```

`dist/index.js` is committed. `node_modules` is not committed.

`action.yml` entry point: `dist/index.js`, runtime: `node20`.

---

## Testing

Jest, unit tests only — no GitHub API calls in parse/match tests.

- `parse.test.js` — fixture strings covering all syntax variants, edge cases (missing template, empty team, exclude patterns)
- `match.test.js` — include/exclude logic, author-is-member skip, no-match exit
- `comments.test.js` — mocked Octokit: create path, update path, marker-not-found path
