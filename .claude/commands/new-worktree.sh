#!/bin/bash
set -e

BRANCH_NAME="$1"

if [ -z "$BRANCH_NAME" ]; then
    echo "Error: Branch name is required"
    echo "Usage: /new-worktree <branch-name>"
    exit 1
fi

# Convert branch name to path-safe name
PATH_SAFE_NAME=$(echo "$BRANCH_NAME" | sed 's/[^a-zA-Z0-9._-]/-/g')
WORKTREE_PATH="../$PATH_SAFE_NAME"

echo "Creating worktree for branch: $BRANCH_NAME"
echo "Worktree path: $WORKTREE_PATH"

# Check if worktree path already exists
if [ -d "$WORKTREE_PATH" ]; then
    echo "Error: Directory $WORKTREE_PATH already exists"
    exit 1
fi

# Check if branch exists locally
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    echo "Branch $BRANCH_NAME exists locally"
    LOCAL_BRANCH_EXISTS=true
else
    echo "Branch $BRANCH_NAME does not exist locally"
    LOCAL_BRANCH_EXISTS=false
fi

# Check if branch exists remotely
if git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
    echo "Branch $BRANCH_NAME exists remotely"
    REMOTE_BRANCH_EXISTS=true
else
    echo "Branch $BRANCH_NAME does not exist remotely"
    REMOTE_BRANCH_EXISTS=false
fi

# If branch doesn't exist locally or remotely, exit
if [ "$LOCAL_BRANCH_EXISTS" = false ] && [ "$REMOTE_BRANCH_EXISTS" = false ]; then
    echo "Error: Branch $BRANCH_NAME does not exist locally or remotely"
    exit 1
fi

# Create the worktree
if [ "$LOCAL_BRANCH_EXISTS" = true ]; then
    # Branch exists locally, create worktree from local branch
    git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
else
    # Branch exists remotely but not locally, create worktree and track remote branch
    git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" "origin/$BRANCH_NAME"
fi

echo "✅ Worktree created successfully at $WORKTREE_PATH"
echo "To navigate to the worktree, run: cd $WORKTREE_PATH"