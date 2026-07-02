// ================================================================
//  TITAN GOLF — NFC Grip Cap  v2.0
//
//  Based on reference: self-tapping grip screw style
//  ─────────────────────────────────────────────────
//  • Flat 30 mm disc, T logo embossed on top
//  • 26 × 2 mm NFC recess on underside (hidden when fitted)
//  • Short neck connecting disc to taper
//  • Tapered self-tapping shaft with aggressive pitch thread
//  • Pointed tip — screws directly into rubber grip
//
//  PRINT SETTINGS (Bambu Lab P1S)
//  ──────────────────────────────
//  Orientation  : POINTED TIP DOWN on bed, disc on top
//  Material     : PETG (flexible enough to grip; strong enough to hold)
//  Layer height : 0.15 mm (finer = better thread detail)
//  Walls        : 4 perimeters
//  Infill       : 40 % gyroid
//  Supports     : NONE — tapered shaft self-supports from bed
//  Bed temp     : 70 °C (PETG)
//  Note         : Print at 95 % flow for first layer on threads
// ================================================================

$fn = 64;

// ── Disc ───────────────────────────────────────────────────────
DISC_D   = 30;    // outer diameter (mm)
DISC_H   = 4;     // thickness (mm)
CAV_D    = 26;    // NFC recess diameter (mm)
CAV_H    = 2;     // NFC recess depth on underside (mm)
RIM_H    = 1.0;   // subtle raised rim around disc top edge (mm)
RIM_W    = 1.5;   // rim width (mm)

// ── Neck ───────────────────────────────────────────────────────
NECK_D   = 7.5;   // neck diameter just below disc (mm)
NECK_H   = 2.5;   // neck height (mm)

// ── Self-tapping shaft ─────────────────────────────────────────
SHAFT_TOP_D = 7.5;    // shaft outer diameter at top (mm)
SHAFT_BOT_D = 2.2;    // shaft core diameter at bottom, before tip (mm)
SHAFT_L     = 15;     // shaft length (mm)
PITCH       = 2.2;    // thread pitch — aggressive self-tapping (mm)
TOOTH_H     = 1.1;    // thread tooth height (mm)
TOOTH_ANGLE = 38;     // leading flank angle (degrees)

// ── Tip ────────────────────────────────────────────────────────
TIP_L    = 2.5;   // pointed tip cone length (mm)

// ── Logo ───────────────────────────────────────────────────────
LOGO_H   = 0.9;   // emboss height (mm)
LOGO_SVG = "titan_logo.svg";  // traced from titan-logo.png via potrace

// ================================================================
//  MODEL  (printed tip-down: Z=0 is tip, disc is at top)
// ================================================================
translate([0, 0, TIP_L + SHAFT_L + NECK_H + DISC_H]) {
    // Rotate so disc face is UP and tip points DOWN for print orientation
    rotate([180, 0, 0]) {

        union() {
            // 1. Disc
            disc_body();

            // 2. Neck transition
            translate([0, 0, -NECK_H])
                neck();

            // 3. Tapered self-tapping shaft
            translate([0, 0, -(NECK_H + SHAFT_L)])
                taper_shaft();

            // 4. Pointed tip
            translate([0, 0, -(NECK_H + SHAFT_L + TIP_L)])
                tip_cone();

            // 5. Titan logo embossed on top face
            translate([0, 0, DISC_H])
                titan_logo_emboss();
        }

    }
}

// ── Disc body ──────────────────────────────────────────────────
module disc_body() {
    difference() {
        union() {
            // Main disc
            cylinder(h = DISC_H, d = DISC_D);
            // Subtle raised rim on top face
            translate([0, 0, DISC_H])
                difference() {
                    cylinder(h = RIM_H, d = DISC_D);
                    cylinder(h = RIM_H + 0.1, d = DISC_D - RIM_W * 2);
                }
        }
        // NFC sticker recess on underside
        translate([0, 0, -0.01])
            cylinder(h = CAV_H + 0.01, d = CAV_D);
    }
}

// ── Neck ───────────────────────────────────────────────────────
module neck() {
    cylinder(h = NECK_H, d1 = NECK_D, d2 = NECK_D);
    // Smooth fillet from disc to neck
    translate([0, 0, NECK_H - 0.5])
        cylinder(h = 0.5, d1 = NECK_D, d2 = SHAFT_TOP_D + 0.5);
}

// ── Tapered self-tapping shaft ─────────────────────────────────
module taper_shaft() {
    r_top = SHAFT_TOP_D / 2;
    r_bot = SHAFT_BOT_D / 2;

    // Tapered core
    cylinder(h = SHAFT_L, r1 = r_bot, r2 = r_top);

    // Self-tapping thread rings — tapered to follow core
    turns = floor(SHAFT_L / PITCH);
    for (i = [0 : turns - 1]) {
        z      = i * PITCH;
        t      = z / SHAFT_L;              // 0 = bottom, 1 = top
        r_core = r_bot + (r_top - r_bot) * t;
        r_tip  = r_core + TOOTH_H * (0.6 + 0.4 * t); // wider tooth near top
        translate([0, 0, z])
            thread_tooth(r_core, r_tip, PITCH, TOOTH_ANGLE);
    }
}

module thread_tooth(r_root, r_tip, pitch, ang) {
    // Asymmetric tooth: steep leading edge, gentle trailing edge
    // (self-tapping profile that bites rubber)
    offset_lead  = pitch * tan(ang) * 0.1;
    offset_trail = pitch * 0.55;
    rotate_extrude($fn = 56)
        polygon([
            [r_root - 0.05,  0           ],
            [r_tip,          offset_lead ],
            [r_tip,          offset_trail],
            [r_root - 0.05,  pitch       ],
        ]);
}

// ── Pointed tip ────────────────────────────────────────────────
module tip_cone() {
    cylinder(h = TIP_L, r1 = 0.3, r2 = SHAFT_BOT_D / 2);
}

// ── Titan Logo emboss ──────────────────────────────────────────
// Imports SVG traced from titan-logo.png via potrace (20x20mm).
// Shifted -10,-10 to centre on disc origin.
module titan_logo_emboss() {
    translate([-10, -10, 0])
        linear_extrude(LOGO_H, convexity = 10)
            import(LOGO_SVG, center = false);
}
