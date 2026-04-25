const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { parseOwnership } = require('./parse');
const { matchOwnership, renderTemplate } = require('./match');
const { upsertComment } = require('./comments');

async function run() {
  const token = core.getInput('token');
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
