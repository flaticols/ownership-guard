const { matchOwnership, renderTemplate, patternRoot } = require('../match');

const baseTeam = {
  name: 'payments',
  members: ['alice', 'bob'],
  orgTeams: [],
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

  test('includes org teams in {members}', () => {
    const team = { ...baseTeam, members: ['alice'], orgTeams: ['flaticols/payments-team'], template: '{members}' };
    const result = renderTemplate(team, { pkgs: [], author: 'x' });
    expect(result).toBe('@alice @flaticols/payments-team');
  });

  test('{members} contains only org team when no individual members', () => {
    const team = { ...baseTeam, members: [], orgTeams: ['flaticols/payments-team'], template: '{members}' };
    const result = renderTemplate(team, { pkgs: [], author: 'x' });
    expect(result).toBe('@flaticols/payments-team');
  });
});
