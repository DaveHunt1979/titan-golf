#!/bin/bash
# Rename all player images to a flat, space-free format: {number}_{mood}.png
# Run from the titan-golf root: bash scripts/rename_player_assets.sh

cd "$(dirname "$0")/.." || exit 1
OUT="assets/players"

rename() { [ -f "$1" ] && mv "$1" "$2" && echo "✓ $2" || echo "✗ missing: $1"; }

# ── MOB (01–04) ──────────────────────────────────────────────────
rename "$OUT/Mob/Tony Normal.png"       "$OUT/01_normal.png"
rename "$OUT/Mob/Tony Happy.png"        "$OUT/01_happy.png"
rename "$OUT/Mob/Tony Angry.png"        "$OUT/01_angry.png"

rename "$OUT/Mob/Martin K normal.PNG"   "$OUT/02_normal.png"
rename "$OUT/Mob/Martin K Happy.PNG"    "$OUT/02_happy.png"
rename "$OUT/Mob/Martin K Angry.PNG"    "$OUT/02_angry.png"

rename "$OUT/Mob/JV Normal.png"         "$OUT/03_normal.png"
rename "$OUT/Mob/JV Happy.png"          "$OUT/03_happy.png"
rename "$OUT/Mob/JV Angry.png"          "$OUT/03_angry.png"

rename "$OUT/Mob/Martin Normal.png"     "$OUT/04_normal.png"
rename "$OUT/Mob/Martin Happy.png"      "$OUT/04_happy.png"
rename "$OUT/Mob/Martin Angry.png"      "$OUT/04_angry.png"

# ── DESTROYERS (05–08) ───────────────────────────────────────────
rename "$OUT/destroyers/Darren Nomal.png"  "$OUT/05_normal.png"
rename "$OUT/destroyers/Darren Happy.png"  "$OUT/05_happy.png"
rename "$OUT/destroyers/Darren Angry.png"  "$OUT/05_angry.png"

rename "$OUT/destroyers/Ian Normal.png"    "$OUT/06_normal.png"
rename "$OUT/destroyers/Ian Happy.png"     "$OUT/06_happy.png"
rename "$OUT/destroyers/Ian Angry.png"     "$OUT/06_angry.png"

rename "$OUT/destroyers/John Normal.png"   "$OUT/07_normal.png"
rename "$OUT/destroyers/John Happy.png"    "$OUT/07_happy.png"
rename "$OUT/destroyers/John Angry.png"    "$OUT/07_angry.png"

rename "$OUT/destroyers/Steve Normal.png"  "$OUT/08_normal.png"
rename "$OUT/destroyers/Steve Happy.png"   "$OUT/08_happy.png"
rename "$OUT/destroyers/Steve Angry.png"   "$OUT/08_angry.png"

# ── LEGION SIX (09–12) ───────────────────────────────────────────
rename "$OUT/legion six/Mike Normal.PNG"   "$OUT/09_normal.png"
rename "$OUT/legion six/Mike Happy.PNG"    "$OUT/09_happy.png"
rename "$OUT/legion six/Mike Angry.PNG"    "$OUT/09_angry.png"

rename "$OUT/legion six/Brad Normal.PNG"   "$OUT/10_normal.png"
rename "$OUT/legion six/Brad Happy.PNG"    "$OUT/10_happy.png"
rename "$OUT/legion six/Brad Angry.PNG"    "$OUT/10_angry.png"

rename "$OUT/legion six/Joe Normal.PNG"    "$OUT/11_normal.png"
rename "$OUT/legion six/Joe happy.PNG"     "$OUT/11_happy.png"
rename "$OUT/legion six/Joe Angry.PNG"     "$OUT/11_angry.png"

rename "$OUT/legion six/Julian Normal.PNG" "$OUT/12_normal.png"
rename "$OUT/legion six/Julian Happy.PNG"  "$OUT/12_happy.png"
rename "$OUT/legion six/Julian Angry.PNG"  "$OUT/12_angry.png"

# ── RENEGADES (13–16) ────────────────────────────────────────────
rename "$OUT/renegades/Ross Normal.png"    "$OUT/13_normal.png"
rename "$OUT/renegades/Ross Happy.png"     "$OUT/13_happy.png"
rename "$OUT/renegades/Ross Angry.png"     "$OUT/13_angry.png"

rename "$OUT/renegades/Kevin Normal.png"   "$OUT/14_normal.png"
rename "$OUT/renegades/Kevin Happy.png"    "$OUT/14_happy.png"
rename "$OUT/renegades/Kevin Angry.png"    "$OUT/14_angry.png"

rename "$OUT/renegades/Arron Normal.PNG"   "$OUT/15_normal.png"
rename "$OUT/renegades/Arron Happy.PNG"    "$OUT/15_happy.png"
rename "$OUT/renegades/Arron Angry.PNG"    "$OUT/15_angry.png"

rename "$OUT/renegades/Chris Normal.png"   "$OUT/16_normal.png"
rename "$OUT/renegades/Chris Happy.png"    "$OUT/16_happy.png"
rename "$OUT/renegades/Chris Angry.png"    "$OUT/16_angry.png"

# ── ELITE (17–20) ────────────────────────────────────────────────
rename "$OUT/elite/Ricky_normal.PNG"       "$OUT/17_normal.png"
rename "$OUT/elite/Ricky_Happy.PNG"        "$OUT/17_happy.png"
rename "$OUT/elite/Ricky_Angry.PNG"        "$OUT/17_angry.png"

rename "$OUT/elite/Levi normal.PNG"        "$OUT/18_normal.png"
rename "$OUT/elite/Levi Happy.PNG"         "$OUT/18_happy.png"
rename "$OUT/elite/Levi Angry.PNG"         "$OUT/18_angry.png"

rename "$OUT/elite/CJ normal.PNG"          "$OUT/19_normal.png"
rename "$OUT/elite/CJ happy.PNG"           "$OUT/19_happy.png"
rename "$OUT/elite/CJ angry.PNG"           "$OUT/19_angry.png"

rename "$OUT/elite/Mike Martin Normal.PNG" "$OUT/20_normal.png"
rename "$OUT/elite/Mike Martin Happy.PNG"  "$OUT/20_happy.png"
rename "$OUT/elite/Mike Martin Angry.PNG"  "$OUT/20_angry.png"

# ── INSTIGATORS (21–24) ──────────────────────────────────────────
rename "$OUT/insigators/Stuart Normal.png" "$OUT/21_normal.png"
rename "$OUT/insigators/Stuart Happy.png"  "$OUT/21_happy.png"
rename "$OUT/insigators/Stuart Angry.png"  "$OUT/21_angry.png"

rename "$OUT/insigators/Hendo Normal.PNG"  "$OUT/22_normal.png"
rename "$OUT/insigators/Hendo Happy.PNG"   "$OUT/22_happy.png"
rename "$OUT/insigators/Hendo Angry.PNG"   "$OUT/22_angry.png"

rename "$OUT/insigators/Steve Normal.png"  "$OUT/23_normal.png"
rename "$OUT/insigators/Steve Happy.png"   "$OUT/23_happy.png"
rename "$OUT/insigators/Steve Angry.png"   "$OUT/23_angry.png"

rename "$OUT/insigators/Kev Normal.png"    "$OUT/24_normal.png"
rename "$OUT/insigators/Kev Happy.png"     "$OUT/24_happy.png"
rename "$OUT/insigators/Kev angry.png"     "$OUT/24_angry.png"

echo ""
echo "Done. All player images moved to assets/players/{nn}_{mood}.png"
