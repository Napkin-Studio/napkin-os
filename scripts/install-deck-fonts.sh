#!/usr/bin/env bash
# Install the Deck Maker's fonts (deck-look) for LibreOffice, once per machine that renders decks (PDF, PNG, QA, the deck gate).
#
#   scripts/install-deck-fonts.sh
#
# Copies the vendored STATIC faces (engine/deck/fonts/*/static/*.ttf: Archivo and Source Sans 3, regular, bold, italic, bold italic;
# SIL OFL 1.1) into your user font folder: ~/Library/Fonts on macOS, ~/.local/share/fonts on Linux. Never the variable files
# (named with [wght]): LibreOffice draws a variable font at its default instance, and Source Sans 3's default is ExtraLight, a faint
# hairline. If you already have a variable Archivo or Source Sans 3 installed, the script names it; remove it, or the deck may be
# drawn from it (the LOOK_V3 render then fails its pdffonts check).
#
# Why: LibreOffice 7.4 on macOS does not read a private profile's fonts folder, so the deck's renders only use these fonts when they
# are installed. On Linux run_deck.to_pdf also points LibreOffice at them through fontconfig (FONTCONFIG_FILE), but installing is harmless.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/engine/deck/fonts"
case "$(uname -s)" in
  Darwin) dest="$HOME/Library/Fonts" ;;
  Linux)  dest="${XDG_DATA_HOME:-$HOME/.local/share}/fonts" ;;
  *) echo "install-deck-fonts: unsupported system $(uname -s); copy $src/*/static/*.ttf into your font folder by hand" >&2; exit 2 ;;
esac
mkdir -p "$dest"

n=0
for f in "$src"/*/static/*.ttf; do
  cp -f "$f" "$dest/"
  n=$((n + 1))
done
echo "install-deck-fonts: copied $n static faces into $dest"

if command -v fc-cache >/dev/null 2>&1; then
  fc-cache -f "$dest" >/dev/null 2>&1 || true
fi

# A variable Archivo or Source Sans 3 already installed can win over the static faces.
found=0
for d in "$dest" /Library/Fonts /usr/share/fonts /usr/local/share/fonts; do
  [[ -d "$d" ]] || continue
  while IFS= read -r v; do
    echo "install-deck-fonts: WARNING a variable font is installed and may be used instead of the static faces: $v" >&2
    found=1
  done < <(find "$d" -maxdepth 3 \( -iname 'Archivo*\[*' -o -iname 'SourceSans3*\[*' -o -iname 'SourceSans3VF*' -o -iname 'ArchivoVF*' \) 2>/dev/null)
done
[[ $found -eq 1 ]] && echo "install-deck-fonts: remove the file(s) above, then re-run a deck render" >&2
echo "install-deck-fonts: done. Quit LibreOffice if it is open so it reads the new fonts."
