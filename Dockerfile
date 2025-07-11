FROM ubuntu:latest

# Build arguments for git configuration
ARG GIT_USER_NAME
ARG GIT_USER_EMAIL

# Install dependencies
# jq is required for JSON deserialization in bash scripts (e.g., pr-get-comments.sh)
RUN apt-get update && \
    apt-get install -y curl git sudo python3 build-essential make g++ jq && \
    rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && \
    apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*


# Create dev user with passwordless sudo and home directory
RUN useradd -m -d /home/dev -s /bin/bash dev && \
    usermod -aG sudo dev && \
    echo "dev ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Set user to dev
USER dev

# Set up environment for NVM
ENV NVM_DIR=/home/dev/.nvm

# Install NVM and Node.js as dev user
RUN mkdir -p $NVM_DIR && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && \
    . "$NVM_DIR/nvm.sh" && \
    nvm install --lts && \
    nvm alias default 'lts/*'

# Set up Node.js in PATH for all users and ensure nvm/node are available in all shells
RUN echo 'export NVM_DIR="$HOME/.nvm"' > /home/dev/.bashrc_nvm && \
    echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> /home/dev/.bashrc_nvm && \
    echo 'export PATH="$NVM_DIR/versions/node/$(. $NVM_DIR/nvm.sh && nvm version lts/*)/bin:$PATH"' >> /home/dev/.bashrc_nvm && \
    cat /home/dev/.bashrc_nvm >> /home/dev/.bashrc && \
    rm /home/dev/.bashrc_nvm

# Install Claude Code CLI
RUN . "$NVM_DIR/nvm.sh" && npm install -g @anthropic-ai/claude-code

# Configure git global settings for dev user
RUN git config --global user.name "$GIT_USER_NAME" && \
    git config --global user.email "$GIT_USER_EMAIL"

# Set working directory
WORKDIR /home/dev