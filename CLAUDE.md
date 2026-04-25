# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A GitHub Action (Node.js 20) for package ownership management. The action runs `dist/index.js`, which must be built before the action can execute.

## Key files

- `action.yml` — Action definition: inputs, outputs, entrypoint (`dist/index.js`)
- `package.json` — Dependencies: `@actions/core`, `@actions/github`

## Development

No build tool is configured yet. When adding one (e.g. `@vercel/ncc`), the typical workflow is:

```bash
npm install
npm run build    # compiles src/ → dist/index.js
```

The `dist/` directory must be committed so the action runs without a build step in consumer workflows.

## Architecture notes

- Entry point: `dist/index.js` (compiled output, not a source file)
- Uses `@actions/core` for input/output/logging and `@actions/github` for Octokit-based GitHub API access
- CommonJS module format (`"type": "commonjs"` in package.json)
