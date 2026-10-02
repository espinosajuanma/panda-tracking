#!/usr/bin/env bash

set -euo pipefail

url="https://solutions.slingrs.io/prod/runtime/api/files/public/doc-files/full.json"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
destination="${script_dir}/solutions-api-swagger.json"
temporary_file="$(mktemp "${destination}.XXXXXX")"

cleanup() {
  rm -f -- "$temporary_file"
}
trap cleanup EXIT

curl --fail --location --silent --show-error "$url" --output "$temporary_file"
mv -- "$temporary_file" "$destination"
trap - EXIT

printf 'Downloaded Solutions API Swagger JSON to %s\n' "$destination"
