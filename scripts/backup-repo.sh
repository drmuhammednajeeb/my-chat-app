#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY_URL="${BIZMINDMAKERS_REPO_URL:-https://github.com/drmuhammednajeeb/my-chat-app.git}"
DEFAULT_DESTINATION="${BIZMINDMAKERS_BACKUP_DIR:-../my-chat-app-backups}"
DESTINATION="${1:-$DEFAULT_DESTINATION}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
MIRROR_DIR="$DESTINATION/my-chat-app.git"
BUNDLE_FILE="$DESTINATION/my-chat-app-$TIMESTAMP.bundle"
SOURCE_ARCHIVE="$DESTINATION/my-chat-app-source-$TIMESTAMP.tar.gz"
MANIFEST="$DESTINATION/backup-manifest.txt"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
command -v git >/dev/null 2>&1 || fail "Git is required. Install Git and retry."
mkdir -p "$DESTINATION"

if [[ -d "$MIRROR_DIR" ]]; then
  git --git-dir="$MIRROR_DIR" rev-parse --is-bare-repository >/dev/null 2>&1 || fail "$MIRROR_DIR exists but is not a valid bare Git repository."
  git --git-dir="$MIRROR_DIR" remote set-url origin "$REPOSITORY_URL"
  git --git-dir="$MIRROR_DIR" remote update --prune
else
  git clone --mirror "$REPOSITORY_URL" "$MIRROR_DIR"
fi

DEFAULT_BRANCH="$(git --git-dir="$MIRROR_DIR" symbolic-ref --short HEAD 2>/dev/null || true)"
[[ -n "$DEFAULT_BRANCH" ]] || fail "Could not determine the mirror's default branch."
git --git-dir="$MIRROR_DIR" show-ref --verify --quiet "refs/heads/$DEFAULT_BRANCH" || fail "Default branch ref is missing: $DEFAULT_BRANCH"

git --git-dir="$MIRROR_DIR" bundle create "$BUNDLE_FILE" --all
git bundle verify "$BUNDLE_FILE"
git --git-dir="$MIRROR_DIR" archive --format=tar.gz --prefix=my-chat-app-source/ --output="$SOURCE_ARCHIVE" "refs/heads/$DEFAULT_BRANCH"

cat > "$MANIFEST" <<EOF
Project: BizmindMakers Chat Pro
Repository: $REPOSITORY_URL
Backup UTC: $TIMESTAMP
Default branch: $DEFAULT_BRANCH
Mirror directory: my-chat-app.git
Git bundle: $(basename "$BUNDLE_FILE")
Source archive: $(basename "$SOURCE_ARCHIVE")
Bundle verification: PASS
EOF

printf '\nBackup completed successfully.\n'
printf 'Mirror: %s\nBundle: %s\nSource archive: %s\nManifest: %s\n' "$MIRROR_DIR" "$BUNDLE_FILE" "$SOURCE_ARCHIVE" "$MANIFEST"
printf '\nIMPORTANT: Copy the bundle, archive, and manifest to a second independent location.\n'
