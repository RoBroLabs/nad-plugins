#!/usr/bin/env bash
set -euo pipefail

deno_version="2.7.7"
machine="$(uname -m)"
case "$machine" in
  x86_64)
    package_name="linux-x64-glibc"
    expected_sha256="e552f082369db65131f15b1ff61af913d4561ba24df812f66a4df23b17c1afb8"
    ;;
  aarch64|arm64)
    package_name="linux-arm64-glibc"
    expected_sha256="7ab62d5b85a3395f8e6b2d79fc5296bc73f849667d62105ae36ae688f55a1d84"
    ;;
  *)
    printf 'Unsupported Deno CI architecture: %s\n' "$machine" >&2
    exit 1
    ;;
esac

tool_dir="${NAD_SDK_CI_TOOL_DIR:-$PWD/.ci-tools}"
archive_path="$tool_dir/deno-${package_name}-${deno_version}.tgz"
download_url="https://registry.npmjs.org/@deno/${package_name}/-/${package_name}-${deno_version}.tgz"
mkdir -p "$tool_dir"
curl --fail --location --silent --show-error \
  "$download_url" \
  --output "$archive_path"
printf '%s  %s\n' "$expected_sha256" "$archive_path" | sha256sum --check --status
tar -xzf "$archive_path" -C "$tool_dir" --strip-components=1 package/deno
chmod 0755 "$tool_dir/deno"
rm -f "$archive_path"
"$tool_dir/deno" --version
