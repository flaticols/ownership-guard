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
