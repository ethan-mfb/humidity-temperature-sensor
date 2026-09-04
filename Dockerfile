FROM ubuntu:latest

# Install dependencies
RUN apt-get update && \
    apt-get install -y curl git sudo python3 && \
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

# Install the Claude Code CLI globally and expose node/npm/npx/claude on the
# system PATH so they also work in non-interactive shells (e.g. docker exec)
RUN . "$NVM_DIR/nvm.sh" && \
    npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code && \
    NODE_BIN="$NVM_DIR/versions/node/$(nvm version lts/*)/bin" && \
    sudo ln -sf "$NODE_BIN/node" "$NODE_BIN/npm" "$NODE_BIN/npx" "$NODE_BIN/claude" /usr/local/bin/

# Pre-create the Claude Code config dir so a mounted volume inherits dev ownership
RUN mkdir -p /home/dev/.claude

# Set up Node.js in PATH for all users and ensure nvm/node are available in all shells
RUN echo 'export NVM_DIR="$HOME/.nvm"' > /home/dev/.bashrc_nvm && \
    echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> /home/dev/.bashrc_nvm && \
    echo 'export PATH="$NVM_DIR/versions/node/$(. $NVM_DIR/nvm.sh && nvm version lts/*)/bin:$PATH"' >> /home/dev/.bashrc_nvm && \
    cat /home/dev/.bashrc_nvm >> /home/dev/.bashrc && \
    rm /home/dev/.bashrc_nvm

# Set working directory
WORKDIR /home/dev