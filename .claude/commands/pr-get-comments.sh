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

# Get general PR comments
GENERAL_COMMENTS=$(echo "$PR_INFO" | jq -r '.comments[]? | select(.body | test("(?i)(lgtm|looks good|approved|✅|👍)") | not) | "general\t\(.author.login)\t\(.body)\t\(.createdAt)"' 2>/dev/null || true)

# Get published review comments (line-specific comments) - encode newlines to avoid parsing issues
REVIEW_COMMENTS=$(timeout 10 gh api "repos/:owner/:repo/pulls/$PR_ID/comments" --jq '.[]? | select(.body | test("(?i)(lgtm|looks good|approved|✅|👍)") | not) | "review\t\(.user.login)\t\(.body | gsub("\\r?\\n"; "⏎"))\t\(.created_at)\t\(.path)\t\(if .line then .line else .original_line end)"' 2>/dev/null || true)

# Get review body comments (submitted reviews with body text)
REVIEW_BODY_COMMENTS=$(echo "$PR_INFO" | jq -r '.reviews[]? | select(.body and .body != "" and (.body | test("(?i)(lgtm|looks good|approved|✅|👍)") | not)) | "review-body\t\(.author.login)\t\(.body)\t\(.submittedAt // .createdAt)"' 2>/dev/null || true)

TEMP_FILE=$(mktemp)
{
    if [[ -n "$GENERAL_COMMENTS" ]]; then echo "$GENERAL_COMMENTS"; fi
    if [[ -n "$REVIEW_COMMENTS" ]]; then echo "$REVIEW_COMMENTS"; fi
    if [[ -n "$REVIEW_BODY_COMMENTS" ]]; then echo "$REVIEW_BODY_COMMENTS"; fi
} > "$TEMP_FILE"

# Remove empty lines using bash-only approach
if [[ -f "$TEMP_FILE" ]]; then
    # Read file and remove empty lines
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -n "$line" ]] && echo "$line"
    done < "$TEMP_FILE" > "$TEMP_FILE.clean" 2>/dev/null || touch "$TEMP_FILE.clean"
    mv "$TEMP_FILE.clean" "$TEMP_FILE" 2>/dev/null || touch "$TEMP_FILE"
fi

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
    
    [[ -f "$TEMP_FILE" ]] && unlink "$TEMP_FILE" 2>/dev/null || true
    exit 0
fi

echo ""
echo "📋 Unresolved Comments and Suggested Dev Plans:"
echo "=============================================="

COUNTER=1
declare -a COMMENTS
declare -a DEV_PLANS

# Process each comment record (handling multiline comments)
while IFS= read -r line; do
    # Skip empty lines
    [[ -z "$line" ]] && continue
    
    # Parse the comment record using tab delimiter
    IFS=$'\t' read -r COMMENT_TYPE AUTHOR BODY CREATED_AT PATH LINE_NUM <<< "$line"
    
    # Skip lines without proper data
    [[ -z "$COMMENT_TYPE" || -z "$AUTHOR" ]] && continue
    
    # Decode newlines back for display (using bash substitution)
    DECODED_BODY="${BODY//⏎/$'\n'}"
    
    if [[ "$COMMENT_TYPE" == "review" ]]; then
        COMMENTS[$COUNTER]="$AUTHOR (on $PATH:$LINE_NUM): $DECODED_BODY"
    elif [[ "$COMMENT_TYPE" == "review-body" ]]; then
        COMMENTS[$COUNTER]="$AUTHOR (review): $DECODED_BODY"
    else
        COMMENTS[$COUNTER]="$AUTHOR: $DECODED_BODY"
    fi
    
    # Generate a simple dev plan based on comment content
    DEV_PLAN=""
    
    # Check for common comment patterns and suggest appropriate dev plans (using bash pattern matching)
    LOWER_BODY="${DECODED_BODY,,}"  # Convert to lowercase
    if [[ "$LOWER_BODY" == *"test"* || "$LOWER_BODY" == *"spec"* || "$LOWER_BODY" == *"coverage"* ]]; then
        DEV_PLAN="Add/update unit tests and ensure adequate test coverage"
    elif [[ "$LOWER_BODY" == *"type"* || "$LOWER_BODY" == *"interface"* || "$LOWER_BODY" == *"typescript"* ]]; then
        DEV_PLAN="Fix TypeScript type definitions and improve type safety"
    elif [[ "$LOWER_BODY" == *"error"* || "$LOWER_BODY" == *"exception"* || "$LOWER_BODY" == *"handle"* ]]; then
        DEV_PLAN="Improve error handling and add appropriate error cases"
    elif [[ "$LOWER_BODY" == *"performance"* || "$LOWER_BODY" == *"optimize"* || "$LOWER_BODY" == *"slow"* ]]; then
        DEV_PLAN="Optimize performance and address bottlenecks"
    elif [[ "$LOWER_BODY" == *"document"* || "$LOWER_BODY" == *"comment"* || "$LOWER_BODY" == *"readme"* ]]; then
        DEV_PLAN="Add documentation and code comments"
    elif [[ "$LOWER_BODY" == *"security"* || "$LOWER_BODY" == *"vulnerability"* || "$LOWER_BODY" == *"validate"* ]]; then
        DEV_PLAN="Address security concerns and add input validation"
    elif [[ "$LOWER_BODY" == *"refactor"* || "$LOWER_BODY" == *"clean"* || "$LOWER_BODY" == *"simplify"* ]]; then
        DEV_PLAN="Refactor code for better maintainability and clarity"
    elif [[ "$LOWER_BODY" == *"action"* || "$LOWER_BODY" == *"github"* ]]; then
        DEV_PLAN="Add/update GitHub Actions workflow for automation"
    elif [[ "$LOWER_BODY" == *"constant"* || "$LOWER_BODY" == *"magic"* ]]; then
        DEV_PLAN="Extract magic numbers/strings into well-named constants"
    elif [[ "$LOWER_BODY" == *"dirname"* || "$LOWER_BODY" == *"esm"* || "$LOWER_BODY" == *"module"* ]]; then
        DEV_PLAN="Fix ESM module compatibility issues"
    else
        DEV_PLAN="Address the feedback and implement suggested changes"
    fi
    
    DEV_PLANS[$COUNTER]="$DEV_PLAN"
    
    echo ""
    echo "[$COUNTER] Comment by $AUTHOR ($CREATED_AT):"
    # Truncate body to 200 chars and replace newlines with spaces (bash-only approach)
    TRUNCATED_BODY="${DECODED_BODY:0:200}"
    DISPLAY_BODY="${TRUNCATED_BODY//$'\n'/ }"
    echo "    $DISPLAY_BODY$([ ${#DECODED_BODY} -gt 200 ] && echo "...")"
    echo ""
    echo "    💡 Suggested Dev Plan:"
    echo "    $DEV_PLAN"
    echo ""
    
    ((COUNTER++))
done < "$TEMP_FILE"

[[ -f "$TEMP_FILE" ]] && unlink "$TEMP_FILE" 2>/dev/null || true

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