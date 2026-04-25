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

  test('emits ORG_TEAM token for @org/team line', () => {
    const tokens = tokenize('team: x\n@flaticols/payments-team');
    expect(tokens).toContainEqual({ type: 'ORG_TEAM', value: 'flaticols/payments-team' });
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

  test('collects ORG_TEAM tokens into orgTeams', () => {
    const tokens = [
      { type: 'TEAM', value: 'payments' },
      { type: 'MEMBER', value: 'alice' },
      { type: 'ORG_TEAM', value: 'flaticols/payments-team' },
    ];
    const [team] = parse(tokens);
    expect(team.members).toEqual(['alice']);
    expect(team.orgTeams).toEqual(['flaticols/payments-team']);
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

  test('parses org team alongside individual members', () => {
    const [team] = parseOwnership('team: payments\n+alice\n@flaticols/payments-team');
    expect(team.members).toEqual(['alice']);
    expect(team.orgTeams).toEqual(['flaticols/payments-team']);
  });

  test('returns empty array for empty input', () => {
    expect(parseOwnership('')).toEqual([]);
  });
});
