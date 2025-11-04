#!/bin/bash

# Install starkli in the container

set -e

echo "🔧 Installing starkli..."

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
    x86_64)
        STARKLI_ARCH="amd64"
        ;;
    aarch64|arm64)
        STARKLI_ARCH="arm64"
        ;;
    *)
        echo "❌ Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

echo "   Architecture: $ARCH ($STARKLI_ARCH)"

# Download and install
cd /tmp
STARKLI_URL="https://github.com/xJonathanLEI/starkli/releases/latest/download/starkli-linux-${STARKLI_ARCH}.tar.gz"

echo "   Downloading from: $STARKLI_URL"

curl -L "$STARKLI_URL" -o starkli.tar.gz || {
    echo "❌ Failed to download starkli"
    echo "   Trying alternative: using starkliup installer..."
    
    # Try using starkliup
    if [ -f "$HOME/.local/bin/starkliup" ]; then
        "$HOME/.local/bin/starkliup" || true
    else
        curl -L https://docs.starkli.rs/install/starkli-latest.sh | sh || {
            echo "❌ Both methods failed"
            exit 1
        }
    fi
}

if [ -f starkli.tar.gz ]; then
    tar -xzf starkli.tar.gz
    mkdir -p "$HOME/.local/bin"
    mv starkli "$HOME/.local/bin/starkli"
    chmod +x "$HOME/.local/bin/starkli"
    rm starkli.tar.gz
fi

# Add to PATH if not already there
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    export PATH="$HOME/.local/bin:$PATH"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
fi

# Test installation
if command -v starkli &> /dev/null; then
    echo "✅ starkli installed successfully!"
    starkli --version
else
    echo "❌ starkli installation failed - check if it's in PATH"
    echo "   PATH: $PATH"
    exit 1
fi

