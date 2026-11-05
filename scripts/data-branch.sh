#!/usr/bin/env bash
# Generated forecast files (posters, bank images, hourly JSON) live on the `data` branch,
# not on `main`, so the main repository stops growing every day.
#
# The data branch always holds exactly ONE commit with no history: each publish replaces it.
# The Pages deploy workflow combines `main` (the website code) with `data` (the latest files).
#
#   scripts/data-branch.sh restore
#       Copy the latest generated files from the data branch into the working tree, so the
#       generators see the previous outputs (freshness checks, keep-last-good-image behaviour).
#
#   scripts/data-branch.sh publish "<commit message>" <dir | file | 'glob'>...
#       Copy those generated paths from the working tree onto the data branch and push it.
#       Quote globs (e.g. 'instagram/generated/seven-day-*') so two workflows that write to the
#       same folder only ever replace their own files.
#       Only generated file types (png, webp, jpg, json) are copied; source files are never touched.
#
# Bootstrap: if the data branch does not exist yet, `restore` seeds the working tree from the
# last commit on main that still contained the generated files.
set -euo pipefail

BRANCH="${DATA_BRANCH:-data}"
KEEP_DAYS="${KEEP_POSTER_DAYS:-14}"
ALL_PATHS=(instagram/generated instagram/seven-day-test banks/generated banks/hourly banks/locations.json pilot/generated pilot/cache)

# Copy generated file types (png/webp/jpg/json) from one folder to another, keeping sub-paths.
# With --delete, generated files in the destination that no longer exist in the source are removed.
# Plain find/cp, so it works on any runner.
GEN_FIND=( \( -name '*.png' -o -name '*.webp' -o -name '*.jpg' -o -name '*.json' \) )
copy_generated() {
  local src="$1" dst="$2" del="${3:-}" rel
  mkdir -p "$dst"
  if [ "$del" = --delete ]; then
    (cd "$dst" && find . -type f "${GEN_FIND[@]}") | while IFS= read -r rel; do
      [ -e "$src/$rel" ] || rm -f "$dst/$rel"
    done
  fi
  [ -d "$src" ] || return 0
  (cd "$src" && find . -type f "${GEN_FIND[@]}") | while IFS= read -r rel; do
    mkdir -p "$dst/$(dirname "$rel")"; cp "$src/$rel" "$dst/$rel"
  done
}

remote_sha() { git ls-remote --heads origin "$BRANCH" | awk '{print $1}'; }

restore() {
  local sha tmp
  sha="$(remote_sha)"
  tmp="$(mktemp -d)"
  if [ -n "$sha" ]; then
    git fetch --quiet --depth=1 origin "$BRANCH"
    git archive "$sha" | tar -x -C "$tmp"
    echo "DATA: restoring generated files from $BRANCH@${sha:0:8}"
  else
    # First run: find the last main commit that still had the generated files.
    git fetch --quiet --unshallow origin 2>/dev/null || git fetch --quiet origin
    local removed src
    removed="$(git log -1 --format=%H --diff-filter=D -- instagram/generated/seven-day-manifest.json || true)"
    src="${removed:+$removed^}"; src="${src:-HEAD}"
    echo "DATA: $BRANCH branch not found; seeding from ${src}"
    local present=()
    for p in "${ALL_PATHS[@]}"; do git cat-file -e "$src:$p" 2>/dev/null && present+=("$p"); done
    [ "${#present[@]}" -gt 0 ] && git archive "$src" "${present[@]}" | tar -x -C "$tmp"
  fi
  for p in "${ALL_PATHS[@]}"; do
    [ -e "$tmp/$p" ] || continue
    if [ -d "$tmp/$p" ]; then copy_generated "$tmp/$p" "$p"; else mkdir -p "$(dirname "$p")"; cp "$tmp/$p" "$p"; fi
  done
  rm -rf "$tmp"
}

prune_posters() {
  # Keep only the last $KEEP_DAYS dated daily posters.
  local dir="$1/instagram/generated" cutoff
  [ -d "$dir" ] || return 0
  cutoff="$(TZ=America/Jamaica date -d "-${KEEP_DAYS} days" +%F)"
  find "$dir" -maxdepth 1 -name 'marine-weather-jamaica-*.png' | while read -r f; do
    d="$(basename "$f" .png)"; d="${d#marine-weather-jamaica-}"
    if [[ "$d" < "$cutoff" ]]; then rm -f "$f"; echo "DATA: pruned old poster $d"; fi
  done
}

publish() {
  local message="$1"; shift
  [ "$#" -gt 0 ] || { echo "publish needs at least one path" >&2; exit 2; }
  git config user.name >/dev/null || git config user.name 'github-actions[bot]'
  git config user.email >/dev/null || git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  for attempt in 1 2 3 4 5; do
    local sha tmp index tree commit old_tree=""
    sha="$(remote_sha)"
    tmp="$(mktemp -d)"; index="$(mktemp -u)"
    if [ -n "$sha" ]; then
      git fetch --quiet --depth=1 origin "$BRANCH"
      git archive "$sha" | tar -x -C "$tmp"
      old_tree="$(git rev-parse "$sha^{tree}")"
    fi
    for p in "$@"; do
      if [[ "$p" == *'*'* ]]; then
        # Glob: replace exactly the matching files, leaving files written by other workflows alone.
        shopt -s nullglob
        local stale=( "$tmp"/$p ) fresh=( $p )
        shopt -u nullglob
        [ "${#stale[@]}" -gt 0 ] && rm -f "${stale[@]}"
        for f in "${fresh[@]}"; do mkdir -p "$tmp/$(dirname "$f")"; cp "$f" "$tmp/$f"; done
      elif [ -d "$p" ]; then copy_generated "$p" "$tmp/$p" --delete
      elif [ -f "$p" ]; then mkdir -p "$tmp/$(dirname "$p")"; cp "$p" "$tmp/$p"
      else echo "DATA: skipping missing $p"; fi
    done
    prune_posters "$tmp"
    local gitdir; gitdir="$(git rev-parse --absolute-git-dir)"
    (cd "$tmp" && GIT_DIR="$gitdir" GIT_WORK_TREE="$tmp" GIT_INDEX_FILE="$index" git add -A .)
    tree="$(GIT_DIR="$gitdir" GIT_INDEX_FILE="$index" git write-tree)"
    rm -rf "$tmp" "$index"
    if [ "$tree" = "$old_tree" ]; then echo "DATA: no changes to publish"; return 0; fi
    # No parent: the data branch never accumulates history.
    commit="$(git commit-tree "$tree" -m "$message")"
    if git push --quiet --force-with-lease="refs/heads/$BRANCH:${sha}" origin "$commit:refs/heads/$BRANCH"; then
      echo "DATA: published ${commit:0:8} to $BRANCH ($message)"; return 0
    fi
    echo "DATA: $BRANCH changed while publishing (attempt $attempt); retrying" >&2
    sleep $((attempt * 3))
  done
  echo "DATA: unable to publish after 5 attempts" >&2; exit 1
}

case "${1:-}" in
  restore) restore ;;
  publish) shift; publish "$@" ;;
  *) echo "usage: $0 restore | publish <message> <path>..." >&2; exit 2 ;;
esac
