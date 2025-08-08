# /pr-resolve-comments

Resolve GitHub pull request comments after addressing the issues.

Usage: `/pr-resolve-comments <pr-id> [comment-ids...]`

Examples: 
- `/pr-resolve-comments 1` - Resolve all comments on PR #1
- `/pr-resolve-comments 1 2200922270 2201006037` - Resolve specific comments on PR #1

This command will:
1. Fetch the specified PR comments using GitHub CLI
2. Allow you to specify which comments to resolve (or resolve all)
3. Update each comment with a "✅ **RESOLVED**" status and explanation
4. Provide confirmation of successful updates

```bash
./.claude/commands/pr-resolve-comments.sh "$@"
```