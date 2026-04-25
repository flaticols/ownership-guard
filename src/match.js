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
