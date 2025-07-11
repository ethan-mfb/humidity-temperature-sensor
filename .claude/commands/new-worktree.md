Create a new git worktree for the specified branch.

Usage: `/new-worktree <branch-name>`

Example: `/new-worktree feature/123-my-new-feature-branch`

This command will:
1. Check if the branch exists locally or remotely
2. Create a new git worktree in `../<path-safe-branch-name>`
3. Check out the specified branch in the new worktree

```bash
./.claude/commands/new-worktree.sh "$1"
```