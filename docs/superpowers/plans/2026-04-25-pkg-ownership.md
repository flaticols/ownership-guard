# pkg-ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Action that reads a `.ownership` file, detects cross-team PR changes, and upserts one comment per affected team on every push.

**Architecture:** Four CommonJS modules — `parse.js` (file → Team[]), `match.js` (Team[] + changed files → MatchResult[]), `comments.js` (Octokit comment upsert), `index.js` (orchestration). Bundled to `dist/index.js` via `@vercel/ncc`.

**Tech Stack:** Node 20, @actions/core, @actions/github, minimatch@3 (CJS-compatible), @vercel/ncc (dev), Jest (dev)

---

### Task 1: Project setup

**Files:**
- Modify: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git**

```bash
git init
```

- [ ] **Step 2: Update `package.json`**

Replace the full contents of `package.json`:
```json
{
  "name": "pkg-ownership",
  "version": "1.0.0",
  "description": "GitHub Action for cross-team ownership enforcement in monorepos",
  "main": "src/index.js",
  "scripts": {
    "build": "ncc build src/index.js -o dist",
    "test": "jest"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "dependencies": {
    "@actions/core": "^3.0.1",
    "@actions/github": "^9.1.1",
    "minimatch": "^3.1.2"
  },
  "devDependencies": {
    "@vercel/ncc": "^0.38.3",
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
```

(`dist/` is intentionally absent — it must be committed so the action runs without a build step in consumer repos.)

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, `package-lock.json` updated, no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: project setup with deps and build tooling"
```

---

### Task 2: `src/parse.js`

**Files:**
- Create: `src/parse.js`
- Create: `src/__tests__/parse.test.js`

Architecture: two-phase — `tokenize(text) → Token[]` then `parse(tokens) → Team[]`. The tokenizer is the only place that reads raw text; the parser only sees typed tokens.

Token types:
- `TEAM` — `team: <name>` line, value = team name
- `MEMBER` — `+<login>` line, value = login
- `SECTION_OWNERSHIP` — `=ownership:` line
- `SECTION_TEMPLATE` — `=template:` line
- `PATTERN` — bare include glob (outside template)
- `EXCLUDE` — `!<glob>` line (outside template), value = glob without `!`
- `TEXT` — any line inside a template section, raw = original line

The tokenizer switches into template mode on `SECTION_TEMPLATE` and emits all subsequent lines as `TEXT` until it sees a `team:` line (which resets template mode and emits `TEAM`). This is the only mode the tokenizer tracks.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/parse.test.js`:
```js
const { tokenize, parse, parseOwnership } = require('../parse');

// ── tokenizer ──────────────────────────────────────────────────────────────

describe('tokenize', () => {
  test('emits TEAM token with name', () => {
    expect(tokenize('team: payments')).toEqual([{ type: 'TEAM', value: 'payments' }]);
  });

  test('emits MEMBER token', () => {
    const tokens = tokenize('team: x\n+alice');
    expect(tokens).toContainEqual({ type: 'MEMBER', value: 'alice' });
  });

  test('emits SECTION_OWNERSHIP token', () => {
    const tokens = tokenize('team: x\n=ownership:');
    expect(tokens).toContainEqual({ type: 'SECTION_OWNERSHIP' });
  });

  test('emits SECTION_TEMPLATE token', () => {
    const tokens = tokenize('team: x\n=template:');
    expect(tokens).toContainEqual({ type: 'SECTION_TEMPLATE' });
  });

  test('emits PATTERN token for bare line in ownership section', () => {
    const tokens = tokenize('team: x\n=ownership:\npackages/payments/**');
    expect(tokens).toContainEqual({ type: 'PATTERN', value: 'packages/payments/**' });
  });

  test('emits EXCLUDE token for !-prefixed line', () => {
    const tokens = tokenize('team: x\n=ownership:\n!packages/shared/**');
    expect(tokens).toContainEqual({ type: 'EXCLUDE', value: 'packages/shared/**' });
  });

  test('emits TEXT tokens in template mode, preserving raw line', () => {
    const tokens = tokenize('team: x\n=template:\nhello {team}');
    expect(tokens).toContainEqual({ type: 'TEXT', raw: 'hello {team}' });
  });

  test('lines that look like patterns inside template are TEXT, not PATTERN', () => {
    const tokens = tokenize('team: x\n=template:\npackages/payments/**');
    expect(tokens.some(t => t.type === 'PATTERN')).toBe(false);
    expect(tokens).toContainEqual({ type: 'TEXT', raw: 'packages/payments/**' });
  });

  test('template mode ends at next team: line', () => {
    const tokens = tokenize('team: a\n=template:\nsome text\nteam: b');
    expect(tokens.filter(t => t.type === 'TEAM')).toHaveLength(2);
    expect(tokens).toContainEqual({ type: 'TEXT', raw: 'some text' });
  });

  test('skips blank lines outside template mode', () => {
    const tokens = tokenize('\n\nteam: x\n\n+alice\n\n');
    expect(tokens).toEqual([
      { type: 'TEAM', value: 'x' },
      { type: 'MEMBER', value: 'alice' },
    ]);
  });
});

// ── parser ─────────────────────────────────────────────────────────────────

describe('parse', () => {
  test('builds a team from TEAM + MEMBER tokens', () => {
    const tokens = [
      { type: 'TEAM', value: 'payments' },
      { type: 'MEMBER', value: 'alice' },
      { type: 'MEMBER', value: 'bob' },
    ];
    const [team] = parse(tokens);
    expect(team.name).toBe('payments');
    expect(team.members).toEqual(['alice', 'bob']);
  });

  test('collects include and exclude patterns', () => {
    const tokens = [
      { type: 'TEAM', value: 'payments' },
      { type: 'SECTION_OWNERSHIP' },
      { type: 'PATTERN', value: 'packages/payments/**' },
      { type: 'EXCLUDE', value: 'packages/payments/shared/**' },
    ];
    const [team] = parse(tokens);
    expect(team.includePatterns).toEqual(['packages/payments/**']);
    expect(team.excludePatterns).toEqual(['packages/payments/shared/**']);
  });

  test('collects template TEXT lines and joins them', () => {
    const tokens = [
      { type: 'TEAM', value: 'payments' },
      { type: 'SECTION_TEMPLATE' },
      { type: 'TEXT', raw: '<!-- ownership-bot: {team} -->' },
      { type: 'TEXT', raw: 'hello {team}' },
    ];
    const [team] = parse(tokens);
    expect(team.template).toBe('<!-- ownership-bot: {team} -->\nhello {team}');
  });

  test('template is null when no TEXT tokens follow SECTION_TEMPLATE', () => {
    const tokens = [
      { type: 'TEAM', value: 'payments' },
      { type: 'SECTION_TEMPLATE' },
    ];
    const [team] = parse(tokens);
    expect(team.template).toBeNull();
  });

  test('builds multiple teams from sequential TEAM tokens', () => {
    const tokens = [
      { type: 'TEAM', value: 'a' },
      { type: 'MEMBER', value: 'alice' },
      { type: 'TEAM', value: 'b' },
      { type: 'MEMBER', value: 'bob' },
    ];
    const teams = parse(tokens);
    expect(teams).toHaveLength(2);
    expect(teams[0].name).toBe('a');
    expect(teams[1].name).toBe('b');
  });

  test('returns empty array for empty token list', () => {
    expect(parse([])).toEqual([]);
  });
});

// ── integration ────────────────────────────────────────────────────────────

describe('parseOwnership', () => {
  test('full round-trip: members, patterns, template', () => {
    const input = [
      'team: payments',
      '+alice',
      '=ownership:',
      'packages/payments/**',
      '!packages/payments/shared/**',
      '=template:',
      '<!-- ownership-bot: {team} -->',
      'hello {team}',
    ].join('\n');
    const [team] = parseOwnership(input);
    expect(team.name).toBe('payments');
    expect(team.members).toEqual(['alice']);
    expect(team.includePatterns).toEqual(['packages/payments/**']);
    expect(team.excludePatterns).toEqual(['packages/payments/shared/**']);
    expect(team.template).toBe('<!-- ownership-bot: {team} -->\nhello {team}');
  });

  test('parses multiple teams', () => {
    const teams = parseOwnership('team: a\n+alice\n\nteam: b\n+bob');
    expect(teams).toHaveLength(2);
  });

  test('returns empty array for empty input', () => {
    expect(parseOwnership('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=parse
```

Expected: FAIL with "Cannot find module '../parse'"

- [ ] **Step 3: Implement `src/parse.js`**

Create `src/parse.js`:
```js
const T = {
  TEAM: 'TEAM',
  MEMBER: 'MEMBER',
  SECTION_OWNERSHIP: 'SECTION_OWNERSHIP',
  SECTION_TEMPLATE: 'SECTION_TEMPLATE',
  PATTERN: 'PATTERN',
  EXCLUDE: 'EXCLUDE',
  TEXT: 'TEXT',
};

function tokenize(text) {
  const tokens = [];
  let templateMode = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    if (templateMode) {
      if (line.startsWith('team:')) {
        templateMode = false;
        tokens.push({ type: T.TEAM, value: line.slice(5).trim() });
      } else {
        tokens.push({ type: T.TEXT, raw: rawLine });
      }
      continue;
    }

    if (!line) continue;

    if (line.startsWith('team:')) {
      tokens.push({ type: T.TEAM, value: line.slice(5).trim() });
    } else if (line.startsWith('+')) {
      tokens.push({ type: T.MEMBER, value: line.slice(1).trim() });
    } else if (line === '=ownership:') {
      tokens.push({ type: T.SECTION_OWNERSHIP });
    } else if (line === '=template:') {
      tokens.push({ type: T.SECTION_TEMPLATE });
      templateMode = true;
    } else if (line.startsWith('!')) {
      tokens.push({ type: T.EXCLUDE, value: line.slice(1).trim() });
    } else {
      tokens.push({ type: T.PATTERN, value: line });
    }
  }

  return tokens;
}

function parse(tokens) {
  const teams = [];
  let current = null;
  let section = 'members';

  for (const tok of tokens) {
    if (tok.type === T.TEAM) {
      if (current) teams.push(finalizeTeam(current));
      current = { name: tok.value, members: [], includePatterns: [], excludePatterns: [], templateLines: [] };
      section = 'members';
      continue;
    }

    if (!current) continue;

    switch (tok.type) {
      case T.SECTION_OWNERSHIP: section = 'ownership'; break;
      case T.SECTION_TEMPLATE:  section = 'template';  break;
      case T.MEMBER:   if (section === 'members')   current.members.push(tok.value); break;
      case T.PATTERN:  if (section === 'ownership')  current.includePatterns.push(tok.value); break;
      case T.EXCLUDE:  if (section === 'ownership')  current.excludePatterns.push(tok.value); break;
      case T.TEXT:     current.templateLines.push(tok.raw); break;
    }
  }

  if (current) teams.push(finalizeTeam(current));
  return teams;
}

function finalizeTeam(raw) {
  const lines = [...raw.templateLines];
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return {
    name: raw.name,
    members: raw.members,
    includePatterns: raw.includePatterns,
    excludePatterns: raw.excludePatterns,
    template: lines.length ? lines.join('\n') : null,
  };
}

function parseOwnership(text) {
  return parse(tokenize(text));
}

module.exports = { tokenize, parse, parseOwnership };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=parse
```

Expected: PASS, 21 tests

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat: add ownership file parser (tokenizer + parser)"
jj new
```

---

### Task 3: `src/match.js`

**Files:**
- Create: `src/match.js`
- Create: `src/__tests__/match.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/match.test.js`:
```js
const { matchOwnership, renderTemplate, patternRoot } = require('../match');

const baseTeam = {
  name: 'payments',
  members: ['alice', 'bob'],
  includePatterns: ['packages/payments/**'],
  excludePatterns: [],
  template: null,
};

describe('patternRoot', () => {
  test('strips trailing /**', () => {
    expect(patternRoot('packages/payments/**')).toBe('packages/payments');
  });

  test('strips trailing /*', () => {
    expect(patternRoot('packages/payments/*')).toBe('packages/payments');
  });

  test('strips glob filename segment', () => {
    expect(patternRoot('src/*.js')).toBe('src');
  });

  test('returns pattern unchanged when no glob', () => {
    expect(patternRoot('packages/payments')).toBe('packages/payments');
  });
});

describe('matchOwnership', () => {
  test('matches file against include pattern', () => {
    const results = matchOwnership([baseTeam], ['packages/payments/src/index.js']);
    expect(results).toHaveLength(1);
    expect(results[0].pkgs).toEqual(['packages/payments']);
  });

  test('returns empty when no file matches any team', () => {
    const results = matchOwnership([baseTeam], ['packages/auth/index.js']);
    expect(results).toHaveLength(0);
  });

  test('excludes files matching exclude patterns', () => {
    const team = { ...baseTeam, excludePatterns: ['packages/payments/shared/**'] };
    const results = matchOwnership([team], ['packages/payments/shared/utils.js']);
    expect(results).toHaveLength(0);
  });

  test('includes file matching include but not exclude', () => {
    const team = { ...baseTeam, excludePatterns: ['packages/payments/shared/**'] };
    const results = matchOwnership([team], ['packages/payments/src/index.js']);
    expect(results).toHaveLength(1);
  });

  test('collects unique pkg roots from multiple matched patterns', () => {
    const team = {
      ...baseTeam,
      includePatterns: ['packages/payments/**', 'packages/billing/**'],
    };
    const results = matchOwnership(
      [team],
      ['packages/payments/a.js', 'packages/billing/b.js']
    );
    expect(results[0].pkgs).toEqual(['packages/payments', 'packages/billing']);
  });

  test('does not duplicate pkg root when multiple files match same pattern', () => {
    const results = matchOwnership(
      [baseTeam],
      ['packages/payments/a.js', 'packages/payments/b.js']
    );
    expect(results[0].pkgs).toEqual(['packages/payments']);
  });

  test('handles multiple teams independently', () => {
    const teamB = { ...baseTeam, name: 'platform', includePatterns: ['packages/platform/**'] };
    const results = matchOwnership(
      [baseTeam, teamB],
      ['packages/payments/a.js', 'packages/platform/b.js']
    );
    expect(results).toHaveLength(2);
  });
});

describe('renderTemplate', () => {
  test('substitutes {team}, {members}, {author}, {pkg}', () => {
    const team = { ...baseTeam, template: '{team}|{members}|{author}|{pkg}' };
    const result = renderTemplate(team, { pkgs: ['packages/payments'], author: 'carol' });
    expect(result).toBe('payments|@alice @bob|@carol|packages/payments');
  });

  test('joins multiple pkgs with comma and space', () => {
    const team = { ...baseTeam, template: '{pkg}' };
    const result = renderTemplate(team, { pkgs: ['packages/payments', 'packages/billing'], author: 'carol' });
    expect(result).toBe('packages/payments, packages/billing');
  });

  test('uses default template when team.template is null', () => {
    const result = renderTemplate(baseTeam, { pkgs: ['packages/payments'], author: 'carol' });
    expect(result).toContain('<!-- ownership-bot: payments -->');
    expect(result).toContain('@alice @bob');
    expect(result).toContain('@carol');
    expect(result).toContain('packages/payments');
  });

  test('replaces all occurrences of each variable', () => {
    const team = { ...baseTeam, template: '{team} and {team}' };
    const result = renderTemplate(team, { pkgs: [], author: 'x' });
    expect(result).toBe('payments and payments');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=match
```

Expected: FAIL with "Cannot find module '../match'"

- [ ] **Step 3: Implement `src/match.js`**

Create `src/match.js`:
```js
const minimatch = require('minimatch');

const DEFAULT_TEMPLATE =
  '<!-- ownership-bot: {team} -->\n' +
  ':warning: @{members} — changes detected in `{pkg}`, owned by **{team}**. @{author}, please align with the team before merging.';

function patternRoot(pattern) {
  return pattern
    .replace(/\/\*\*$/, '')
    .replace(/\/\*$/, '')
    .replace(/\/[^/]*\*[^/]*$/, '');
}

function matchOwnership(teams, changedFiles) {
  const results = [];

  for (const team of teams) {
    const matchedFiles = changedFiles.filter(file => {
      const included = team.includePatterns.some(p => minimatch(file, p));
      if (!included) return false;
      return !team.excludePatterns.some(p => minimatch(file, p));
    });

    if (matchedFiles.length === 0) continue;

    const pkgs = [];
    for (const pattern of team.includePatterns) {
      if (!matchedFiles.some(f => minimatch(f, pattern))) continue;
      const root = patternRoot(pattern);
      if (!pkgs.includes(root)) pkgs.push(root);
    }

    results.push({ team, pkgs });
  }

  return results;
}

function renderTemplate(team, { pkgs, author }) {
  const template = team.template || DEFAULT_TEMPLATE;
  const members = team.members.map(m => `@${m}`).join(' ');
  return template
    .replace(/\{team\}/g, team.name)
    .replace(/\{members\}/g, members)
    .replace(/\{author\}/g, `@${author}`)
    .replace(/\{pkg\}/g, pkgs.join(', '));
}

module.exports = { matchOwnership, renderTemplate, patternRoot };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=match
```

Expected: PASS, 15 tests

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat: add file matcher and template renderer"
jj new
```

---

### Task 4: `src/comments.js`

**Files:**
- Create: `src/comments.js`
- Create: `src/__tests__/comments.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/comments.test.js`:
```js
const { upsertComment } = require('../comments');

function makeOctokit(existingComments = []) {
  return {
    rest: {
      issues: {
        listComments: jest.fn().mockResolvedValue({ data: existingComments }),
        createComment: jest.fn().mockResolvedValue({}),
        updateComment: jest.fn().mockResolvedValue({}),
      },
    },
  };
}

const params = {
  owner: 'org',
  repo: 'myrepo',
  prNumber: 42,
  marker: '<!-- ownership-bot: payments -->',
  body: 'updated comment body',
};

describe('upsertComment', () => {
  test('creates a new comment when no existing comment has the marker', async () => {
    const octokit = makeOctokit([{ id: 1, body: 'unrelated comment' }]);
    await upsertComment(octokit, params);
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'myrepo',
      issue_number: 42,
      body: 'updated comment body',
    });
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  test('updates existing comment when marker is found', async () => {
    const octokit = makeOctokit([
      { id: 99, body: 'old text <!-- ownership-bot: payments --> more text' },
    ]);
    await upsertComment(octokit, params);
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'myrepo',
      comment_id: 99,
      body: 'updated comment body',
    });
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  test('creates when comment list is empty', async () => {
    const octokit = makeOctokit([]);
    await upsertComment(octokit, params);
    expect(octokit.rest.issues.createComment).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=comments
```

Expected: FAIL with "Cannot find module '../comments'"

- [ ] **Step 3: Implement `src/comments.js`**

Create `src/comments.js`:
```js
async function upsertComment(octokit, { owner, repo, prNumber, marker, body }) {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existing = comments.find(c => c.body && c.body.includes(marker));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }
}

module.exports = { upsertComment };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=comments
```

Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat: add PR comment upsert module"
jj new
```

---

### Task 5: `src/index.js` and update `action.yml`

**Files:**
- Create: `src/index.js`
- Modify: `action.yml`

- [ ] **Step 1: Update `action.yml`**

Replace the full contents of `action.yml`:
```yaml
name: Package Ownership
description: Warns PR authors and mentions team members when PRs cross team ownership boundaries

inputs:
  token:
    description: GitHub token
    required: true
  ownership-file:
    description: Path to the ownership file relative to repo root
    required: false
    default: '.ownership'

runs:
  using: node20
  main: dist/index.js
```

- [ ] **Step 2: Create `src/index.js`**

Create `src/index.js`:
```js
const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { parseOwnership } = require('./parse');
const { matchOwnership, renderTemplate } = require('./match');
const { upsertComment } = require('./comments');

async function run() {
  const token = core.getInput('token', { required: true });
  const ownershipFile = core.getInput('ownership-file') || '.ownership';

  const { context } = github;
  const pr = context.payload.pull_request;

  if (!pr) {
    core.info('Not a pull_request event — skipping.');
    return;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = context.repo;
  const prNumber = pr.number;
  const author = pr.user.login;

  const ownershipPath = path.join(
    process.env.GITHUB_WORKSPACE || process.cwd(),
    ownershipFile
  );

  if (!fs.existsSync(ownershipPath)) {
    core.setFailed(`Ownership file not found: ${ownershipFile}`);
    return;
  }

  const teams = parseOwnership(fs.readFileSync(ownershipPath, 'utf8'));

  const { data: files } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  const changedFiles = files.map(f => f.filename);

  const matches = matchOwnership(teams, changedFiles);

  if (matches.length === 0) {
    core.info('No ownership matches — exiting.');
    return;
  }

  for (const { team, pkgs } of matches) {
    if (team.members.includes(author)) {
      core.info(`@${author} is a member of ${team.name} — skipping.`);
      continue;
    }

    const body = renderTemplate(team, { pkgs, author });
    const marker = `<!-- ownership-bot: ${team.name} -->`;

    await upsertComment(octokit, { owner, repo, prNumber, marker, body });
    core.info(`Comment upserted for team: ${team.name}`);
  }
}

run().catch(err => core.setFailed(err.message));
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: PASS, all 26 tests across parse, match, comments

- [ ] **Step 4: Commit**

```bash
jj describe -m "feat: add action orchestration and update action.yml"
jj new
```

---

### Task 6: Build, example files, and finalize

**Files:**
- Create: `dist/index.js` (generated by ncc)
- Rename: `.ownership.example` → `.ownership`

- [ ] **Step 1: Build the bundle**

```bash
npm run build
```

Expected: `dist/index.js` created, no errors.

- [ ] **Step 2: Update `.ownership` with correct syntax**

Rename `.ownership.example` to `.ownership` and replace its contents:
```
team: team-foo
+flaticols

=ownership:
path/to/package/**

=template:
<!-- ownership-bot: {team} -->
:warning: @{members} — `{pkg}` belongs to **{team}**. @{author} is crossing a team boundary, please align first.
```

- [ ] **Step 3: Run full test suite one final time**

```bash
npm test
```

Expected: PASS, 26 tests

- [ ] **Step 4: Commit**

```bash
jj describe -m "chore: add built bundle and ownership example file"
jj new
```
