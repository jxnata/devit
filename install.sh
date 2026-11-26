#!/bin/sh
# Installs the latest Devit release:
#   curl -fsSL https://raw.githubusercontent.com/jxnata/devit/master/install.sh | sh
# Environment:
#   DEVIT_VERSION       a tag such as v0.5.0 (default: the latest release)
#   DEVIT_INSTALL_DIR   where to put the binary (default: ~/.local/bin)
#   DEVIT_RELEASE_URL   base URL holding the archives (default: the GitHub release)
set -eu

repo="jxnata/devit"
dir="${DEVIT_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "devit: unsupported OS $(uname -s); build from source: https://github.com/$repo" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "devit: unsupported CPU $(uname -m); build from source: https://github.com/$repo" >&2; exit 1 ;;
esac

if [ -n "${DEVIT_RELEASE_URL:-}" ]; then
  base="$DEVIT_RELEASE_URL"
elif [ -n "${DEVIT_VERSION:-}" ]; then
  base="https://github.com/$repo/releases/download/$DEVIT_VERSION"
else
  base="https://github.com/$repo/releases/latest/download"
fi

archive="devit-$os-$arch.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $archive…"
curl -fsSL "$base/$archive" -o "$tmp/$archive"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"

expected="$(grep " $archive\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$archive" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/$archive" | cut -d' ' -f1)"
fi
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "devit: checksum mismatch for $archive; not installing" >&2
  exit 1
fi

tar -xzf "$tmp/$archive" -C "$tmp"
mkdir -p "$dir"
mv "$tmp/devit" "$dir/devit"
chmod +x "$dir/devit"
echo "Installed devit $("$dir/devit" --version) to $dir/devit"

case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "Add $dir to your PATH, e.g.: echo 'export PATH=\"$dir:\$PATH\"' >> ~/.profile" ;;
esac

cat <<EOF

Next:
  devit doctor                       # checks claude, git and gh
  devit skill install                # lets Claude Code / Codex drive Devit
  cd your-repo && devit init
  devit persona add lead --from lead
  devit persona add dev --from dev
  devit ask "What should we work on first?"

Docs: https://github.com/$repo/tree/master/docs
EOF
