#!/usr/bin/env bash
# Build report.pdf (Tufte handout) from report.md using Docker + pandoc/LaTeX.
#
#   ./build.sh          # build report/report.pdf
#
# Requires a running Docker daemon. First run builds a local image with the
# tufte-latex packages layered on top of pandoc/latex (cached afterwards).
set -euo pipefail
cd "$(dirname "$0")"

IMAGE=ferric-report

docker build -q -t "$IMAGE" . >/dev/null

# The pandoc image's entrypoint is pandoc itself.
docker run --rm -v "$PWD:/work" -w /work "$IMAGE" \
  report.md -o report.pdf --pdf-engine=xelatex

words=$(docker run --rm -v "$PWD:/work" -w /work "$IMAGE" report.md -t plain | wc -w | tr -d ' ')
echo "report.pdf built (body ≈ ${words} words incl. captions)"
