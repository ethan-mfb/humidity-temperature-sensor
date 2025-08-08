#!/usr/bin/env bash

set -e

IMAGE_NAME=humidity-temp-dev
CONTAINER_NAME=humidity-temp-devcontainer
SSH_PORT=2222

# Check for git user arguments
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <git_user_name> <git_user_email>"
    echo "Example: $0 \"John Doe\" \"john@example.com\""
    exit 1
fi

GIT_USER_NAME="$1"
GIT_USER_EMAIL="$2"

# Build the Docker image with git user arguments
docker build -t $IMAGE_NAME \
    --build-arg GIT_USER_NAME="$GIT_USER_NAME" \
    --build-arg GIT_USER_EMAIL="$GIT_USER_EMAIL" \
    .

# Check if the container is running
if [ "$(docker ps -q -f name=^/${CONTAINER_NAME}$)" ]; then
    echo "Container '$CONTAINER_NAME' is already running."
    read -p "Would you like to stop and remove it? [y/N]: " yn
    case "$yn" in
        [Yy]* )
            docker stop $CONTAINER_NAME
            docker rm $CONTAINER_NAME
            ;;
        * )
            echo "Exiting without making changes."
            exit 1
            ;;
    esac
fi

# Remove existing container if it exists (but not running)
if [ "$(docker ps -aq -f name=^/${CONTAINER_NAME}$)" ]; then
    docker rm -f $CONTAINER_NAME
fi

# Create and start the container with container-only storage
docker run -d \
    --name $CONTAINER_NAME \
    --env "NVM_DIR=/root/.nvm" \
    $IMAGE_NAME \
    tail -f /dev/null

echo "Container '$CONTAINER_NAME' is running."
