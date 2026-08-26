-- Fixes 3 of the 9 courses found to have a duplicated front/back nine
-- (holes 1-9 byte-identical to holes 10-18) in the original course-master
-- import. Investigation showed 6 of the 9 (Crane Valley, Leeds Castle,
-- Lullingstone Park Valley, Meon Valley, Westridge, Pine Cliffs' *distance
-- only*) are genuinely 9-hole venues where "18 holes" legitimately means
-- playing the loop twice -- that data was already correct. These 3 were not:
--
-- 1) Seaford Golf Club: a real, distinct 18-hole downland course (6546yd
--    White). The live data (4510yd) matched neither a real 18-hole card nor
--    a legitimate 9-hole-doubled one -- replaced with the club's official
--    4-tee scorecard (golfpass.com), checksummed against the club's own
--    "Par 69 / 6546yd / CR 72.1 / Slope 120" summary. Men's tees only:
--    golfpass's hole-by-hole grid only published one shared Par row, but the
--    women's tee summary shows a different total par (72 vs 69 men's) on
--    the same yardage, meaning specific holes carry a different par for
--    women that the shared grid doesn't break out -- left out rather than
--    guessing which holes differ.
-- 2) Dorset Golf and Country Club: a 27-hole complex of THREE distinct
--    9-hole loops (Lakeland/Parkland/Woodland) where any "18 holes" combines
--    TWO of the three -- not one loop played twice. The live data doubled a
--    single loop. Replaced with a genuine Lakeland(front 9)+Parkland(back 9)
--    round for Blue/White/Red (Men) -- Lakeland's even-numbered stroke
--    indices + Parkland's odd-numbered ones is the club's own real
--    interleaving scheme. Cross-checked against the club's own official
--    "Men - Lakeland and Parkland" CR/Slope PDF: Blue 7027yd/74.0/136,
--    White 6615yd/71.9/133, Red 5469yd/66.2/119 -- all three totals matched
--    exactly by summing golfify.io's two independent 9-hole cards. Yellow
--    was left out: golfify's own Yellow total didn't reconcile with either
--    its own hole-by-hole sum or the official figure, and no corroborating
--    source was found -- excluded rather than guessed. No official women's
--    rating exists yet for this combination ("To be Rated" on the club's own
--    PDF), so women's data isn't added either.
-- 3) Pine Cliffs Golf Course (Portugal): genuinely only a 9-hole course
--    (White 2227m/Par33/CR36.1/Slope126, golfpass.com) with no official
--    18-hole-equivalent rating published anywhere. The live "18-hole" entry
--    had wrong yardage, wrong par, and a nonsensical CR (31.0) that matched
--    neither the real 9-hole nor any plausible doubled figure. Replaced with
--    the real 9-hole card played twice (standard convention also seen at
--    Crane Valley/Leeds Castle/etc: second lap's stroke index continues
--    1-9 -> 10-18 in the same relative order), keeping the official 9-hole
--    CR/Slope as the best available approximation -- noted in `source`,
--    not presented as an official 18-hole rating.
--
-- All three are already-live course_name strings; nothing else about them
-- (course_holes, other tees) is touched. Corrections are DELETE + INSERT
-- (not ON CONFLICT DO NOTHING) because the existing rows are wrong, not
-- merely absent.

DELETE FROM course_tee_holes WHERE course_name = 'Seaford Golf Club';
DELETE FROM course_tees WHERE course_name = 'Seaford Golf Club';

DELETE FROM course_tee_holes WHERE course_name = 'Dorset Golf and Country Club';
DELETE FROM course_tees WHERE course_name = 'Dorset Golf and Country Club';

DELETE FROM course_tee_holes WHERE course_name = 'Pine Cliffs Golf Course';
DELETE FROM course_tees WHERE course_name = 'Pine Cliffs Golf Course';

INSERT INTO course_tees (course_name, tee_name, gender, par, total_distance, distance_unit, course_rating, slope_rating, source, rating_status, source_course_id) VALUES
('Seaford Golf Club', 'White', 'M', 69, 6546, 'yd', 72.1, 120, 'https://www.golfpass.com/courses/34004-seaford-golf-club/scorecard-and-layout', 'VERIFIED', 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Yellow', 'M', 69, 6242, 'yd', 70.3, 120, 'https://www.golfpass.com/courses/34004-seaford-golf-club/scorecard-and-layout', 'VERIFIED', 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Blue', 'M', 69, 5700, 'yd', 67.5, 116, 'https://www.golfpass.com/courses/34004-seaford-golf-club/scorecard-and-layout', 'VERIFIED', 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Red', 'M', 69, 5551, 'yd', 67.1, 114, 'https://www.golfpass.com/courses/34004-seaford-golf-club/scorecard-and-layout', 'VERIFIED', 'SEAFORD_GC_FIX'),

('Dorset Golf and Country Club', 'Blue', 'M', 72, 7027, 'yd', 74.0, 136, 'https://www.golfify.io/courses/dorset-golf-and-country-club-lakeland | https://www.golfify.io/courses/dorset-golf-and-country-club-parkland | https://www.dorsetgolfresort.com/wp-content/uploads/2024/07/Men-Lakeland-and-Parkland.pdf', 'VERIFIED', 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'White', 'M', 72, 6615, 'yd', 71.9, 133, 'https://www.golfify.io/courses/dorset-golf-and-country-club-lakeland | https://www.golfify.io/courses/dorset-golf-and-country-club-parkland | https://www.dorsetgolfresort.com/wp-content/uploads/2024/07/Men-Lakeland-and-Parkland.pdf', 'VERIFIED', 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Red', 'M', 72, 5469, 'yd', 66.2, 119, 'https://www.golfify.io/courses/dorset-golf-and-country-club-lakeland | https://www.golfify.io/courses/dorset-golf-and-country-club-parkland | https://www.dorsetgolfresort.com/wp-content/uploads/2024/07/Men-Lakeland-and-Parkland.pdf', 'VERIFIED', 'DORSET_LAKELAND_PARKLAND_FIX'),

('Pine Cliffs Golf Course', 'White', 'M', 64, 4772, 'm', 36.1, 126, 'https://www.golfpass.com/travel-advisor/courses/25172-pine-cliffs-resort (9-hole course/rating played twice; no official 18-hole rating published)', 'APPROXIMATE', 'PINE_CLIFFS_FIX')
ON CONFLICT (course_name, tee_name, gender) DO NOTHING;

INSERT INTO course_tee_holes (course_name, tee_name, gender, hole_number, distance, par, stroke_index, source_course_id) VALUES
-- Seaford Golf Club -- White (M)
('Seaford Golf Club', 'White', 'M', 1, 372, 4, 13, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'White', 'M', 2, 436, 4, 3, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'White', 'M', 3, 179, 3, 15, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'White', 'M', 4, 392, 4, 9, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'White', 'M', 5, 418, 4, 11, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'White', 'M', 6, 421, 4, 5, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'White', 'M', 7, 163, 3, 17, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'White', 'M', 8, 446, 4, 1, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'White', 'M', 9, 409, 4, 7, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'White', 'M', 10, 325, 4, 16, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'White', 'M', 11, 370, 4, 10, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'White', 'M', 12, 182, 3, 18, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'White', 'M', 13, 444, 4, 2, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'White', 'M', 14, 416, 4, 6, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'White', 'M', 15, 221, 3, 12, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'White', 'M', 16, 555, 5, 8, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'White', 'M', 17, 398, 4, 4, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'White', 'M', 18, 399, 4, 14, 'SEAFORD_GC_FIX'),
-- Seaford Golf Club -- Yellow (M)
('Seaford Golf Club', 'Yellow', 'M', 1, 354, 4, 13, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Yellow', 'M', 2, 426, 4, 3, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Yellow', 'M', 3, 169, 3, 15, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Yellow', 'M', 4, 366, 4, 9, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Yellow', 'M', 5, 383, 4, 11, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Yellow', 'M', 6, 393, 4, 5, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Yellow', 'M', 7, 145, 3, 17, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Yellow', 'M', 8, 441, 4, 1, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Yellow', 'M', 9, 395, 4, 7, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Yellow', 'M', 10, 314, 4, 16, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Yellow', 'M', 11, 363, 4, 10, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Yellow', 'M', 12, 156, 3, 18, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Yellow', 'M', 13, 432, 4, 2, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Yellow', 'M', 14, 407, 4, 6, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Yellow', 'M', 15, 205, 3, 12, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Yellow', 'M', 16, 532, 5, 8, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Yellow', 'M', 17, 388, 4, 4, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Yellow', 'M', 18, 373, 4, 14, 'SEAFORD_GC_FIX'),
-- Seaford Golf Club -- Blue (M)
('Seaford Golf Club', 'Blue', 'M', 1, 338, 4, 13, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Blue', 'M', 2, 378, 4, 3, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Blue', 'M', 3, 147, 3, 15, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Blue', 'M', 4, 348, 4, 9, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Blue', 'M', 5, 368, 4, 11, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Blue', 'M', 6, 372, 4, 5, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Blue', 'M', 7, 143, 3, 17, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Blue', 'M', 8, 414, 4, 1, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Blue', 'M', 9, 370, 4, 7, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Blue', 'M', 10, 274, 4, 16, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Blue', 'M', 11, 329, 4, 10, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Blue', 'M', 12, 148, 3, 18, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Blue', 'M', 13, 383, 4, 2, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Blue', 'M', 14, 328, 4, 6, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Blue', 'M', 15, 168, 3, 12, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Blue', 'M', 16, 471, 5, 8, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Blue', 'M', 17, 372, 4, 4, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Blue', 'M', 18, 349, 4, 14, 'SEAFORD_GC_FIX'),
-- Seaford Golf Club -- Red (M)
('Seaford Golf Club', 'Red', 'M', 1, 338, 4, 13, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Red', 'M', 2, 410, 4, 3, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Red', 'M', 3, 140, 3, 15, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Red', 'M', 4, 294, 4, 9, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Red', 'M', 5, 347, 4, 11, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Red', 'M', 6, 376, 4, 5, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Red', 'M', 7, 138, 3, 17, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Red', 'M', 8, 417, 4, 1, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Red', 'M', 9, 363, 4, 7, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Red', 'M', 10, 271, 4, 16, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Red', 'M', 11, 304, 4, 10, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Red', 'M', 12, 142, 3, 18, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Red', 'M', 13, 394, 4, 2, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Red', 'M', 14, 320, 4, 6, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Red', 'M', 15, 165, 3, 12, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Red', 'M', 16, 437, 5, 8, 'SEAFORD_GC_FIX'),
('Seaford Golf Club', 'Red', 'M', 17, 369, 4, 4, 'SEAFORD_GC_FIX'), ('Seaford Golf Club', 'Red', 'M', 18, 326, 4, 14, 'SEAFORD_GC_FIX'),
-- Dorset Golf and Country Club -- Blue (M): holes 1-9 Lakeland, 10-18 Parkland
('Dorset Golf and Country Club', 'Blue', 'M', 1, 409, 4, 8, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Blue', 'M', 2, 506, 5, 14, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Blue', 'M', 3, 358, 4, 16, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Blue', 'M', 4, 208, 3, 12, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Blue', 'M', 5, 465, 4, 4, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Blue', 'M', 6, 604, 5, 2, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Blue', 'M', 7, 160, 3, 18, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Blue', 'M', 8, 397, 4, 10, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Blue', 'M', 9, 403, 4, 6, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Blue', 'M', 10, 346, 4, 17, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Blue', 'M', 11, 490, 5, 9, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Blue', 'M', 12, 460, 4, 3, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Blue', 'M', 13, 455, 4, 1, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Blue', 'M', 14, 418, 4, 7, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Blue', 'M', 15, 210, 3, 11, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Blue', 'M', 16, 537, 5, 5, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Blue', 'M', 17, 204, 3, 15, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Blue', 'M', 18, 397, 4, 13, 'DORSET_LAKELAND_PARKLAND_FIX'),
-- Dorset Golf and Country Club -- White (M)
('Dorset Golf and Country Club', 'White', 'M', 1, 388, 4, 8, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'White', 'M', 2, 483, 5, 14, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'White', 'M', 3, 358, 4, 16, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'White', 'M', 4, 184, 3, 12, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'White', 'M', 5, 425, 4, 4, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'White', 'M', 6, 561, 5, 2, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'White', 'M', 7, 160, 3, 18, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'White', 'M', 8, 367, 4, 10, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'White', 'M', 9, 380, 4, 6, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'White', 'M', 10, 327, 4, 17, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'White', 'M', 11, 478, 5, 9, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'White', 'M', 12, 427, 4, 3, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'White', 'M', 13, 422, 4, 1, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'White', 'M', 14, 388, 4, 7, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'White', 'M', 15, 201, 3, 11, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'White', 'M', 16, 516, 5, 5, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'White', 'M', 17, 184, 3, 15, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'White', 'M', 18, 366, 4, 13, 'DORSET_LAKELAND_PARKLAND_FIX'),
-- Dorset Golf and Country Club -- Red (M)
('Dorset Golf and Country Club', 'Red', 'M', 1, 346, 4, 8, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Red', 'M', 2, 403, 5, 14, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Red', 'M', 3, 262, 4, 16, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Red', 'M', 4, 158, 3, 12, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Red', 'M', 5, 353, 4, 4, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Red', 'M', 6, 482, 5, 2, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Red', 'M', 7, 138, 3, 18, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Red', 'M', 8, 287, 4, 10, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Red', 'M', 9, 292, 4, 6, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Red', 'M', 10, 270, 4, 17, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Red', 'M', 11, 427, 5, 9, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Red', 'M', 12, 354, 4, 3, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Red', 'M', 13, 357, 4, 1, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Red', 'M', 14, 313, 4, 7, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Red', 'M', 15, 142, 3, 11, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Red', 'M', 16, 433, 5, 5, 'DORSET_LAKELAND_PARKLAND_FIX'),
('Dorset Golf and Country Club', 'Red', 'M', 17, 136, 3, 15, 'DORSET_LAKELAND_PARKLAND_FIX'), ('Dorset Golf and Country Club', 'Red', 'M', 18, 316, 4, 13, 'DORSET_LAKELAND_PARKLAND_FIX'),

-- Pine Cliffs Golf Course -- White (M): 9 real holes played twice, SI+9 for the second lap
('Pine Cliffs Golf Course', 'White', 'M', 1, 291, 4, 7, 'PINE_CLIFFS_FIX'), ('Pine Cliffs Golf Course', 'White', 'M', 2, 157, 3, 6, 'PINE_CLIFFS_FIX'),
('Pine Cliffs Golf Course', 'White', 'M', 3, 348, 4, 2, 'PINE_CLIFFS_FIX'), ('Pine Cliffs Golf Course', 'White', 'M', 4, 141, 3, 9, 'PINE_CLIFFS_FIX'),
('Pine Cliffs Golf Course', 'White', 'M', 5, 431, 4, 1, 'PINE_CLIFFS_FIX'), ('Pine Cliffs Golf Course', 'White', 'M', 6, 215, 3, 3, 'PINE_CLIFFS_FIX'),
('Pine Cliffs Golf Course', 'White', 'M', 7, 344, 4, 4, 'PINE_CLIFFS_FIX'), ('Pine Cliffs Golf Course', 'White', 'M', 8, 295, 4, 5, 'PINE_CLIFFS_FIX'),
('Pine Cliffs Golf Course', 'White', 'M', 9, 164, 3, 8, 'PINE_CLIFFS_FIX'), ('Pine Cliffs Golf Course', 'White', 'M', 10, 291, 4, 16, 'PINE_CLIFFS_FIX'),
('Pine Cliffs Golf Course', 'White', 'M', 11, 157, 3, 15, 'PINE_CLIFFS_FIX'), ('Pine Cliffs Golf Course', 'White', 'M', 12, 348, 4, 11, 'PINE_CLIFFS_FIX'),
('Pine Cliffs Golf Course', 'White', 'M', 13, 141, 3, 18, 'PINE_CLIFFS_FIX'), ('Pine Cliffs Golf Course', 'White', 'M', 14, 431, 4, 10, 'PINE_CLIFFS_FIX'),
('Pine Cliffs Golf Course', 'White', 'M', 15, 215, 3, 12, 'PINE_CLIFFS_FIX'), ('Pine Cliffs Golf Course', 'White', 'M', 16, 344, 4, 13, 'PINE_CLIFFS_FIX'),
('Pine Cliffs Golf Course', 'White', 'M', 17, 295, 4, 14, 'PINE_CLIFFS_FIX'), ('Pine Cliffs Golf Course', 'White', 'M', 18, 164, 3, 17, 'PINE_CLIFFS_FIX')
ON CONFLICT (course_name, tee_name, gender, hole_number) DO NOTHING;
