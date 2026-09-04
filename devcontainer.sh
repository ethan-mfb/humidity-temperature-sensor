#!/usr/bin/env bash

set -e

IMAGE_NAME=humidity-temp-dev
CONTAINER_NAME=humidity-temp-devcontainer
CLAUDE_VOLUME=humidity-temp-claude
SSH_PORT=2222

# Build the Docker image
docker build -t $IMAGE_NAME .

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

# Create and start the container with container-only storage.
# $CLAUDE_VOLUME persists the Claude Code CLI login/config across rebuilds.
docker run -d \
    --name $CONTAINER_NAME \
    --env "NVM_DIR=/root/.nvm" \
    --volume $CLAUDE_VOLUME:/home/dev/.claude \
    $IMAGE_NAME \
    tail -f /dev/null

echo "Container '$CONTAINER_NAME' is running."
