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

# Get PR information including source branch, comments, and reviews
PR_INFO=$(gh pr view "$PR_ID" --json headRefName,comments,reviews,author 2>/dev/null || {
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

# Get general PR comments
GENERAL_COMMENTS=$(echo "$PR_INFO" | jq -r '.comments[]? | select(.body | test("(?i)(lgtm|looks good|approved|✅|👍)") | not) | "general||||\(.author.login)||||\(.body)||||\(.createdAt)"' 2>/dev/null || true)

# Get published review comments (line-specific comments)
REVIEW_COMMENTS=$(timeout 10 gh api "repos/:owner/:repo/pulls/$PR_ID/comments" --jq '.[]? | select(.body | test("(?i)(lgtm|looks good|approved|✅|👍)") | not) | "review||||\(.user.login)||||\(.body)||||\(.created_at)||||\(.path)||||\(if .line then .line else .original_line end)"' 2>/dev/null || true)

# Get review body comments (submitted reviews with body text)
REVIEW_BODY_COMMENTS=$(echo "$PR_INFO" | jq -r '.reviews[]? | select(.body and .body != "" and (.body | test("(?i)(lgtm|looks good|approved|✅|👍)") | not)) | "review-body||||\(.author.login)||||\(.body)||||\(.submittedAt // .createdAt)"' 2>/dev/null || true)

TEMP_FILE=$(mktemp)
{
    if [[ -n "$GENERAL_COMMENTS" ]]; then echo "$GENERAL_COMMENTS"; fi
    if [[ -n "$REVIEW_COMMENTS" ]]; then echo "$REVIEW_COMMENTS"; fi
    if [[ -n "$REVIEW_BODY_COMMENTS" ]]; then echo "$REVIEW_BODY_COMMENTS"; fi
} > "$TEMP_FILE"

# Remove empty lines
grep -v '^$' "$TEMP_FILE" > "$TEMP_FILE.clean" 2>/dev/null || true
mv "$TEMP_FILE.clean" "$TEMP_FILE" 2>/dev/null || true

if [[ ! -s "$TEMP_FILE" ]]; then
    # Check if there are pending reviews that might contain draft comments
    PENDING_REVIEWS=$(echo "$PR_INFO" | jq -r '.reviews[]? | select(.state == "PENDING") | .author.login' 2>/dev/null | wc -l)
    
    if [[ $PENDING_REVIEWS -gt 0 ]]; then
        echo "⚠️  No submitted comments found, but there are $PENDING_REVIEWS pending review(s)"
        echo ""
        echo "📝 Note: Draft/pending review comments are only visible in the GitHub web interface"
        echo "   and cannot be accessed via the GitHub API until the review is submitted."
        echo ""
        echo "🔗 View pending comments at: https://github.com/$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')/pull/$PR_ID/files"
        echo ""
        echo "💡 To access these comments programmatically:"
        echo "   1. Ask the reviewer to submit their pending review, or"
        echo "   2. Manually copy the comments from the GitHub web interface"
    else
        echo "✅ No unresolved comments found for PR #$PR_ID"
    fi
    
    rm "$TEMP_FILE"
    exit 0
fi

echo ""
echo "📋 Unresolved Comments and Suggested Dev Plans:"
echo "=============================================="

COUNTER=1
declare -a COMMENTS
declare -a DEV_PLANS

while IFS='||||' read -r COMMENT_TYPE AUTHOR BODY CREATED_AT PATH LINE; do
    # Skip empty lines
    [[ -z "$AUTHOR" ]] && continue
    
    if [[ "$COMMENT_TYPE" == "review" ]]; then
        COMMENTS[$COUNTER]="$AUTHOR (on $PATH:$LINE): $BODY"
    elif [[ "$COMMENT_TYPE" == "review-body" ]]; then
        COMMENTS[$COUNTER]="$AUTHOR (review): $BODY"
    else
        COMMENTS[$COUNTER]="$AUTHOR: $BODY"
    fi
    
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