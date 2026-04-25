# ownership-guard

> GitHub Action that enforces cross-team awareness in monorepo PRs.

When a PR touches files owned by a team the author doesn't belong to, the action posts a warning comment mentioning the owning team's members. One comment per team, updated on every push — no thread spam.

## Usage

```yaml
on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

jobs:
  ownership:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: flaticols/ownership-guard@v1
```

No token input needed — defaults to the built-in `GITHUB_TOKEN`.

## `.ownership` file

Place an `.ownership` file at the repo root:

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
:warning: @{members} — `{pkg}` belongs to **{team}**. @{author} is crossing a team boundary, please align first.
```

### Syntax

| Line | Meaning |
|------|---------|
| `team: <name>` | Starts a team block |
| `+<github-login>` | Adds a member to the current team |
| `=ownership:` | Starts glob patterns for the team |
| `packages/foo/**` | Files this team owns (include) |
| `!packages/foo/shared/**` | Excluded from ownership |
| `=template:` | Custom comment body for this team |

### Template variables

| Variable | Value |
|----------|-------|
| `{team}` | Team name |
| `{members}` | `@alice @bob` |
| `{author}` | PR author `@login` |
| `{pkg}` | Matched package root(s), e.g. `packages/payments` |

If a team has no `=template:` section, a default warning is used.

> [!NOTE]
> Files that match no team's patterns are considered **shared packages**. The action exits silently — no comment is posted. Enforce approvals for shared packages via GitHub rulesets.

> [!TIP]
> The hidden comment `<!-- ownership-bot: {team} -->` in your template is the upsert marker. The action finds and updates that comment on every push rather than creating a new one.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | No | `${{ github.token }}` | GitHub token |
| `ownership-file` | No | `.ownership` | Path to the ownership file |

## How it works

1. Reads `.ownership` from the repo root
2. Gets the list of changed files in the PR
3. For each team whose patterns match: skips if the PR author is already a member, otherwise upserts a comment mentioning the team
4. If no patterns match any changed file, exits silently

## License

ISC
