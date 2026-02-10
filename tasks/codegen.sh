#!/bin/sh
# Generate DeepCopy methods and CRD/RBAC/webhook manifests.
set -eu

echo "Generating code and manifests"
controller-gen object:headerFile="hack/boilerplate.go.txt" paths="./..."
controller-gen rbac:roleName=manager-role crd webhook paths="./..." output:crd:artifacts:config=config/crd/bases
