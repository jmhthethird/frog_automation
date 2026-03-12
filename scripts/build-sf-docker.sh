#!/usr/bin/env bash
# scripts/build-sf-docker.sh
#
# Builds the Screaming Frog Docker image used for containerised crawl isolation.
#
# Each crawl job that uses this image runs inside its own ephemeral container,
# giving it a completely isolated filesystem (including ~/.ScreamingFrogSEOSpider/)
# so multiple crawls can run simultaneously without sharing state or lock files.
#
# After the image is built, enable Docker-mode crawling by setting:
#   export SF_DOCKER_IMAGE=frog-automation-sf:latest
# before starting the Frog Automation server.
#
# Environment variables:
#   SF_VERSION    Screaming Frog version to bake in (default: 23.3)
#   IMAGE_NAME    Docker image name (default: frog-automation-sf)
#   IMAGE_TAG     Docker image tag  (default: latest)
#
# Usage:
#   bash scripts/build-sf-docker.sh
#   SF_VERSION=23.3 bash scripts/build-sf-docker.sh
#   IMAGE_NAME=my-sf IMAGE_TAG=23.3 bash scripts/build-sf-docker.sh

set -euo pipefail

SF_VERSION="${SF_VERSION:-23.3}"
IMAGE_NAME="${IMAGE_NAME:-frog-automation-sf}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
FULL_IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"

echo "==> Building Screaming Frog Docker image"
echo "    SF version : ${SF_VERSION}"
echo "    Image      : ${FULL_IMAGE}"
echo "    Dockerfile : Dockerfile.sf"
echo ""

# Resolve project root (the directory containing Dockerfile.sf).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

docker build \
    -f "${PROJECT_ROOT}/Dockerfile.sf" \
    --build-arg "SF_VERSION=${SF_VERSION}" \
    -t "${FULL_IMAGE}" \
    "${PROJECT_ROOT}"

echo ""
echo "==> Image built: ${FULL_IMAGE}"
echo ""
echo "    To enable Docker-mode crawling, set the following environment variable"
echo "    before starting the Frog Automation server:"
echo ""
echo "      export SF_DOCKER_IMAGE=${FULL_IMAGE}"
echo ""
echo "    Multiple crawls will then run in parallel, each in its own container"
echo "    with a fully isolated filesystem."
