#!/usr/bin/env bash
# install-sf-linux.sh
#
# Downloads and installs Screaming Frog SEO Spider on Debian/Ubuntu Linux.
# After installation the launcher is available at:
#   /usr/bin/ScreamingFrogSEOSpiderLauncher
#
# Environment variables
#   SF_VERSION   Version to install (default: 21.3)
#
# Usage
#   bash scripts/install-sf-linux.sh
#   SF_VERSION=21.3 bash scripts/install-sf-linux.sh

set -euo pipefail

SF_VERSION="${SF_VERSION:-21.3}"
DOWNLOAD_URL="https://download.screamingfrog.co.uk/products/screaming-frog-seo-spider/ScreamingFrogSEOSpider-${SF_VERSION}.deb"
TMP_DEB="/tmp/ScreamingFrogSEOSpider-${SF_VERSION}.deb"

echo "==> Screaming Frog SEO Spider Linux installer"
echo "    Version : ${SF_VERSION}"
echo "    URL     : ${DOWNLOAD_URL}"

# ── Download ──────────────────────────────────────────────────────────────────
if [ -f "${TMP_DEB}" ]; then
  echo "==> Using cached installer at ${TMP_DEB}"
else
  echo "==> Downloading..."
  curl -fsSL -o "${TMP_DEB}" "${DOWNLOAD_URL}"
fi

# ── Install ───────────────────────────────────────────────────────────────────
echo "==> Installing (requires sudo)..."
sudo apt-get install -y "${TMP_DEB}"

# ── Verify ────────────────────────────────────────────────────────────────────
echo "==> Verifying installation..."
SF_BIN="/usr/bin/ScreamingFrogSEOSpiderLauncher"

if [ -x "${SF_BIN}" ]; then
  echo "    OK – launcher found at ${SF_BIN}"
else
  echo "    Warning: expected launcher not found at ${SF_BIN}"
  echo "    Searching for SF executables under /usr..."
  found=$(find /usr -name "ScreamingFrogSEOSpider*" -type f 2>/dev/null | head -5)
  if [ -n "${found}" ]; then
    echo "${found}"
  else
    echo "    No SF executables found – installation may have failed."
    exit 1
  fi
fi

echo "==> Done."
