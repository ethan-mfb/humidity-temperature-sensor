#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Usage function
usage() {
    echo "Usage: $0 <pr-id> [comment-ids...]"
    echo ""
    echo "Examples:"
    echo "  $0 1                           # Resolve all comments on PR #1"
    echo "  $0 1 2200922270 2201006037     # Resolve specific comments on PR #1"
    echo ""
    echo "This command will update PR comments with resolved status."
    exit 1
}

# Check if PR ID is provided
if [ $# -lt 1 ]; then
    echo -e "${RED}❌ Error: PR ID is required${NC}"
    usage
fi

PR_ID="$1"
shift

# Function to get all comment IDs and preview text
get_all_comments() {
    local pr_id="$1"
    echo -e "${BLUE}🔍 Fetching all comments for PR #${pr_id}...${NC}"
    
    if ! gh api "repos/:owner/:repo/pulls/${pr_id}/comments" --jq '.[] | "\(.id)|\(.body | split("\n")[0] | .[0:80])..."' 2>/dev/null; then
        echo -e "${RED}❌ Failed to fetch comments for PR #${pr_id}${NC}"
        return 1
    fi
}

# Function to resolve a specific comment
resolve_comment() {
    local comment_id="$1"
    local resolution_message="$2"
    
    echo -e "${YELLOW}🔄 Resolving comment ${comment_id}...${NC}"
    
    # Get original comment body
    local original_body
    if ! original_body=$(gh api "repos/:owner/:repo/pulls/comments/${comment_id}" --jq '.body' 2>/dev/null); then
        echo -e "${RED}❌ Failed to fetch comment ${comment_id}${NC}"
        return 1
    fi
    
    # Check if already resolved
    if echo "$original_body" | grep -q "✅ \*\*RESOLVED\*\*"; then
        echo -e "${YELLOW}⚠️  Comment ${comment_id} is already resolved${NC}"
        return 0
    fi
    
    # Create new body with resolution
    local new_body="${original_body}

✅ **RESOLVED**: ${resolution_message}"
    
    # Update the comment
    if gh api "repos/:owner/:repo/pulls/comments/${comment_id}" \
        -X PATCH \
        -f body="$new_body" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Successfully resolved comment ${comment_id}${NC}"
    else
        echo -e "${RED}❌ Failed to resolve comment ${comment_id}${NC}"
        return 1
    fi
}

# Function to interactively resolve comments
resolve_comments_interactive() {
    local pr_id="$1"
    
    echo -e "${BLUE}📋 Available comments for PR #${pr_id}:${NC}"
    echo "================================"
    
    # Get comments in a more readable format
    local comments_data
    if ! comments_data=$(gh api "repos/:owner/:repo/pulls/${pr_id}/comments" --jq '.[] | {id: .id, body: (.body | split("\n")[0] | .[0:100])}' 2>/dev/null); then
        echo -e "${RED}❌ Failed to fetch comments${NC}"
        return 1
    fi
    
    # Display comments with numbers
    local comment_ids=()
    local counter=1
    
    echo "$comments_data" | jq -r '.id' | while read -r comment_id; do
        comment_ids+=("$comment_id")
        local preview
        preview=$(echo "$comments_data" | jq -r "select(.id == $comment_id) | .body")
        echo -e "${YELLOW}[$counter]${NC} ID: ${comment_id}"
        echo -e "    Preview: ${preview}..."
        echo ""
        ((counter++))
    done
    
    # Get comment IDs for resolution
    readarray -t comment_ids < <(echo "$comments_data" | jq -r '.id')
    
    echo -e "${BLUE}Enter resolution message (will be prefixed with '✅ **RESOLVED**: '):${NC}"
    read -r resolution_message
    
    if [ -z "$resolution_message" ]; then
        echo -e "${RED}❌ Resolution message cannot be empty${NC}"
        return 1
    fi
    
    echo ""
    echo -e "${BLUE}Which comments would you like to resolve?${NC}"
    echo "Enter comment numbers (space-separated), 'all', or 'quit':"
    read -r selection
    
    case "$selection" in
        "quit"|"q")
            echo -e "${YELLOW}Cancelled${NC}"
            return 0
            ;;
        "all"|"a")
            echo -e "${BLUE}Resolving all comments...${NC}"
            for comment_id in "${comment_ids[@]}"; do
                resolve_comment "$comment_id" "$resolution_message"
            done
            ;;
        *)
            echo -e "${BLUE}Resolving selected comments...${NC}"
            for num in $selection; do
                if [[ "$num" =~ ^[0-9]+$ ]] && [ "$num" -ge 1 ] && [ "$num" -le "${#comment_ids[@]}" ]; then
                    local idx=$((num - 1))
                    resolve_comment "${comment_ids[$idx]}" "$resolution_message"
                else
                    echo -e "${RED}❌ Invalid selection: $num${NC}"
                fi
            done
            ;;
    esac
}

# Main logic
if [ $# -eq 0 ]; then
    # No specific comment IDs provided - interactive mode
    resolve_comments_interactive "$PR_ID"
else
    # Specific comment IDs provided
    echo -e "${BLUE}Enter resolution message (will be prefixed with '✅ **RESOLVED**: '):${NC}"
    read -r resolution_message
    
    if [ -z "$resolution_message" ]; then
        echo -e "${RED}❌ Resolution message cannot be empty${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}Resolving specified comments...${NC}"
    for comment_id in "$@"; do
        resolve_comment "$comment_id" "$resolution_message"
    done
fi

echo -e "${GREEN}🎉 Comment resolution process completed!${NC}"