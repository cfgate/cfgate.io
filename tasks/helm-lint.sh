#!/bin/sh
# Lint the Helm chart.
set -eu

echo "Linting charts/cfgate"
helm lint charts/cfgate
