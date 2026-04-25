const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { parseOwnership } = require('./parse');
const { matchOwnership, renderTemplate } = require('./match');
const { upsertComment, deleteComment } = require('./comments');

async function checkMembership(octokit, team, author) {
  if (team.members.includes(author)) return true;
  for (const orgTeam of (team.orgTeams || [])) {
    const [org, teamSlug] = orgTeam.split('/');
    try {
      await octokit.rest.teams.getMembershipForUserInOrg({
        org,
        team_slug: teamSlug,
        username: author,
      });
      return true;
    } catch {
      // 404 = not a member
    }
  }
  return false;
}

async function hasTeamApproval(octokit, { owner, repo, prNumber }, team) {
  const { data: reviews } = await octokit.rest.pulls.listReviews({
    owner,
    repo,
    pull_number: prNumber,
  });

  const latestByUser = new Map();
  for (const review of reviews) {
    if (review.state !== 'PENDING') {
      latestByUser.set(review.user.login, review.state);
    }
  }

  for (const [login, state] of latestByUser) {
    if (state === 'APPROVED' && await checkMembership(octokit, team, login)) {
      return true;
    }
  }
  return false;
}

async function run() {
  const token = core.getInput('token');
  const ownershipFile = core.getInput('ownership-file') || '.ownership';
  const failOnViolation = core.getInput('fail-on-violation') !== 'false';

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

  let failed = false;
  const summaryRows = [];

  for (const { team, pkgs } of matches) {
    const marker = `<!-- ownership-bot: ${team.name} -->`;

    if (await checkMembership(octokit, team, author)) {
      core.info(`@${author} is a member of ${team.name} — skipping.`);
      await deleteComment(octokit, { owner, repo, prNumber, marker });
      summaryRows.push([team.name, pkgs.join(', '), 'Author is a team member']);
      continue;
    }

    if (await hasTeamApproval(octokit, { owner, repo, prNumber }, team)) {
      core.info(`Approved by a member of ${team.name} — skipping.`);
      await deleteComment(octokit, { owner, repo, prNumber, marker });
      summaryRows.push([team.name, pkgs.join(', '), 'Approved by team member']);
      continue;
    }

    const body = renderTemplate(team, { pkgs, author });
    await upsertComment(octokit, { owner, repo, prNumber, marker, body });

    if (failOnViolation) {
      for (const file of changedFiles.filter(f => pkgs.some(pkg => f.startsWith(pkg)))) {
        core.error(`Owned by ${team.name} — approval required`, { file });
      }
      summaryRows.push([team.name, pkgs.join(', '), 'Approval required']);
      failed = true;
    } else {
      summaryRows.push([team.name, pkgs.join(', '), 'Comment posted']);
    }
  }

  await core.summary
    .addHeading('Ownership Check', 2)
    .addTable([
      [{ data: 'Team', header: true }, { data: 'Packages', header: true }, { data: 'Status', header: true }],
      ...summaryRows,
    ])
    .write();

  if (failed) {
    core.setFailed('Ownership check failed. Request approval from the owning teams.');
  }
}

run().catch(err => core.setFailed(err.message));
