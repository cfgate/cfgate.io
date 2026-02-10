#!/bin/sh
# Format and vet Go source code.
set -eu

echo "Running fmt and vet"

go fmt ./...
go vet ./...
