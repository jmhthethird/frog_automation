#!/usr/bin/env bash
# install-sf-linux.sh
#
# Downloads and installs Screaming Frog SEO Spider on Debian/Ubuntu Linux.
# After installation the launcher is available at:
#   /usr/bin/ScreamingFrogSEOSpiderLauncher
#
# Environment variables
#   SF_VERSION          Version to install (default: 21.3)
#   SF_LICENSE_USERNAME Screaming Frog account e-mail (optional)
#   SF_LICENSE_KEY      Screaming Frog licence key   (optional)
#
# When both SF_LICENSE_USERNAME and SF_LICENSE_KEY are set the script also
# writes the licence file required for headless / CLI operation:
#   ~/.ScreamingFrogSEOSpider/licence.txt
# and ensures the EULA has been accepted in:
#   ~/.ScreamingFrogSEOSpider/spider.config
#
# Usage
#   bash scripts/install-sf-linux.sh
#   SF_VERSION=21.3 bash scripts/install-sf-linux.sh
#   SF_LICENSE_USERNAME=me@example.com SF_LICENSE_KEY=XXXX-XXXX-XXXX bash scripts/install-sf-linux.sh

set -euo pipefail

SF_VERSION="${SF_VERSION:-23.3}"
DOWNLOAD_URL="https://download.screamingfrog.co.uk/products/seo-spider/screamingfrogseospider_${SF_VERSION}_all.deb"
TMP_DEB="/tmp/screamingfrogseospider_${SF_VERSION}_all.deb"

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
sudo dpkg -i "${TMP_DEB}" || sudo apt-get install -f -y

# ── Verify ────────────────────────────────────────────────────────────────────
echo "==> Verifying installation..."
SF_BIN="/usr/bin/ScreamingFrogSEOSpiderLauncher"

if [ -x "${SF_BIN}" ]; then
  echo "    OK – launcher found at ${SF_BIN}"
else
  echo "    Warning: expected launcher not found at ${SF_BIN}"
  echo "    Searching for SF executables under /usr..."
  found=$(find /usr -name "ScreamingFrogSEOSpider*" -type f 2>/dev/null | head -5 || true)
  if [ -n "${found}" ]; then
    echo "${found}"
  else
    echo "    No SF executables found – installation may have failed."
    exit 1
  fi
fi

# ── Licence activation (optional) ─────────────────────────────────────────────
# Screaming Frog headless / CLI mode requires the licence to be pre-activated
# via a credentials file.  There is no --license-key CLI flag.
# When both SF_LICENSE_USERNAME and SF_LICENSE_KEY are provided, this block
# writes the expected files so the binary can run without a GUI.
if [ -n "${SF_LICENSE_USERNAME:-}" ] && [ -n "${SF_LICENSE_KEY:-}" ]; then
  echo "==> Activating licence for ${SF_LICENSE_USERNAME}..."
  SF_CONFIG_DIR="${HOME}/.ScreamingFrogSEOSpider"
  mkdir -p "${SF_CONFIG_DIR}"

  # licence.txt: line 1 = username/e-mail, line 2 = licence key
  printf '%s\n%s\n' "${SF_LICENSE_USERNAME}" "${SF_LICENSE_KEY}" > "${SF_CONFIG_DIR}/licence.txt"
  echo "    Licence file written to ${SF_CONFIG_DIR}/licence.txt"

  # Accept the EULA so the binary can run headlessly.
  SPIDER_CONFIG="${SF_CONFIG_DIR}/spider.config"
  if [ ! -f "${SPIDER_CONFIG}" ]; then
    echo "eula.accepted=11" > "${SPIDER_CONFIG}"
  elif ! grep -q "^eula.accepted=" "${SPIDER_CONFIG}"; then
    echo "eula.accepted=11" >> "${SPIDER_CONFIG}"
  fi
  echo "    EULA accepted in ${SPIDER_CONFIG}"
else
  echo "==> Skipping licence activation (SF_LICENSE_USERNAME or SF_LICENSE_KEY not set)."
  echo "    Re-run with both vars set, or manually write ~/.ScreamingFrogSEOSpider/licence.txt"
  echo "    (line 1: account e-mail, line 2: licence key) and add 'eula.accepted=11' to spider.config."
fi

echo "==> Done."
