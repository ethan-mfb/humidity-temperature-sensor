#!/bin/bash

# Get pull request comments and generate dev plans for unresolved issues
# Usage: ./pr-get-comments.sh <pr-id>

set -euo pipefail

PR_ID="$1"

if [[ -z "$PR_ID" ]]; then
    echo "❌ Error: Pull request ID is required"
    echo "Usage: /pr-get-comments <pr-id>"
    exit 1
fi

# Check if gh is available
if ! command -v gh &> /dev/null; then
    echo "❌ Error: GitHub CLI (gh) is not installed"
    echo "Please install it with: sudo apt install gh"
    exit 1
fi

# Check if we're authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Error: Not authenticated with GitHub"
    echo "Please run: gh auth login"
    exit 1
fi

echo "🔍 Fetching PR information for #$PR_ID..."

# Get PR information including source branch
PR_INFO=$(gh pr view "$PR_ID" --json headRefName,comments 2>/dev/null || {
    echo "❌ Error: Could not fetch PR #$PR_ID"
    echo "Please check that the PR exists and you have access to it"
    exit 1
})

# Extract the source branch name
SOURCE_BRANCH=$(echo "$PR_INFO" | jq -r '.headRefName')

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)

# Check if we're on the correct branch
if [[ "$CURRENT_BRANCH" != "$SOURCE_BRANCH" ]]; then
    echo "❌ Error: Wrong branch checked out"
    echo "Current branch: $CURRENT_BRANCH"
    echo "PR source branch: $SOURCE_BRANCH"
    echo ""
    echo "Please check out the PR source branch and try again:"
    echo "git checkout $SOURCE_BRANCH"
    exit 1
fi

echo "✅ On correct branch: $SOURCE_BRANCH"
echo "🔍 Fetching comments..."

# Extract comments from PR info
COMMENTS_JSON=$(echo "$PR_INFO" | jq '{comments: .comments}')

# Parse comments and filter for unresolved ones
# GitHub doesn't have a direct "unresolved" flag, so we'll look for comments that:
# 1. Are not from the author
# 2. Don't have responses from the author addressing them
# 3. Are not simple approvals/lgtm messages

TEMP_FILE=$(mktemp)
echo "$COMMENTS_JSON" | jq -r '.comments[] | select(.body | test("(?i)(lgtm|looks good|approved|✅|👍)") | not) | "\(.author.login)||||\(.body)||||\(.createdAt)"' > "$TEMP_FILE"

if [[ ! -s "$TEMP_FILE" ]]; then
    echo "✅ No unresolved comments found for PR #$PR_ID"
    rm "$TEMP_FILE"
    exit 0
fi

echo ""
echo "📋 Unresolved Comments and Suggested Dev Plans:"
echo "=============================================="

COUNTER=1
declare -a COMMENTS
declare -a DEV_PLANS

while IFS='||||' read -r AUTHOR BODY CREATED_AT; do
    # Skip empty lines
    [[ -z "$AUTHOR" ]] && continue
    
    COMMENTS[$COUNTER]="$AUTHOR: $BODY"
    
    # Generate a simple dev plan based on comment content
    DEV_PLAN=""
    
    # Check for common comment patterns and suggest appropriate dev plans
    if echo "$BODY" | grep -qi "test\|spec\|coverage"; then
        DEV_PLAN="Add/update unit tests and ensure adequate test coverage"
    elif echo "$BODY" | grep -qi "type\|interface\|typescript"; then
        DEV_PLAN="Fix TypeScript type definitions and improve type safety"
    elif echo "$BODY" | grep -qi "error\|exception\|handle"; then
        DEV_PLAN="Improve error handling and add appropriate error cases"
    elif echo "$BODY" | grep -qi "performance\|optimize\|slow"; then
        DEV_PLAN="Optimize performance and address bottlenecks"
    elif echo "$BODY" | grep -qi "document\|comment\|readme"; then
        DEV_PLAN="Add documentation and code comments"
    elif echo "$BODY" | grep -qi "security\|vulnerability\|validate"; then
        DEV_PLAN="Address security concerns and add input validation"
    elif echo "$BODY" | grep -qi "refactor\|clean\|simplify"; then
        DEV_PLAN="Refactor code for better maintainability and clarity"
    else
        DEV_PLAN="Address the feedback and implement suggested changes"
    fi
    
    DEV_PLANS[$COUNTER]="$DEV_PLAN"
    
    echo ""
    echo "[$COUNTER] Comment by $AUTHOR ($(date -d "$CREATED_AT" '+%Y-%m-%d %H:%M')):"
    echo "    $(echo "$BODY" | head -c 200 | tr '\n' ' ')$([ ${#BODY} -gt 200 ] && echo "...")"
    echo ""
    echo "    💡 Suggested Dev Plan:"
    echo "    $DEV_PLAN"
    echo ""
    
    ((COUNTER++))
done < "$TEMP_FILE"

rm "$TEMP_FILE"

TOTAL_COMMENTS=$((COUNTER - 1))

if [[ $TOTAL_COMMENTS -eq 0 ]]; then
    echo "✅ No unresolved comments found for PR #$PR_ID"
    exit 0
fi

echo "=============================================="
echo "Found $TOTAL_COMMENTS unresolved comment(s)"
echo ""
echo "To address specific comments, you can:"
echo "1. Reference them by number: 'Address comment #1'"
echo "2. Select multiple: 'Address comments #1, #3, #5'"
echo "3. Address all: 'Address all comments'"
echo ""
echo "The dev plans above are suggestions - feel free to modify them as needed."