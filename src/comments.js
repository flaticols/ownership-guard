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

async function deleteComment(octokit, { owner, repo, prNumber, marker }) {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existing = comments.find(c => c.body && c.body.includes(marker));
  if (existing) {
    await octokit.rest.issues.deleteComment({
      owner,
      repo,
      comment_id: existing.id,
    });
  }
}

module.exports = { upsertComment, deleteComment };
