Get pull request comments and generate dev plans for unresolved issues.

Usage: `/pr-get-comments <pr-id>`

Example: `/pr-get-comments 1`

This command will:
1. Fetch all comments for the specified pull request using GitHub CLI
2. Filter for unresolved comments (those without resolved/approved status)
3. Generate development plans for each unresolved comment
4. Display them in a numbered list for user selection
5. Allow user to confirm which tasks to address

```bash
./.claude/commands/pr-get-comments.sh "$1"
```

ARGUMENTS: pr-id (required) - The pull request ID number