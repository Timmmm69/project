INSERT INTO "scoring_schemes" (
  "id",
  "name",
  "subject",
  "exam_type",
  "year",
  "max_raw_score",
  "max_scaled_score",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  '8d6b534d-83f9-4d75-9f16-d3b8a63af4d8'::uuid,
  'РИКЗ 2026 русский язык ЦЭ/ЦТ',
  'russian',
  'ce_ct',
  2026,
  80,
  100,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM "scoring_schemes"
  WHERE "subject" = 'russian'
    AND "exam_type" = 'ce_ct'
    AND "year" = 2026
    AND "max_raw_score" = 80
    AND "max_scaled_score" = 100
);

WITH scheme AS (
  SELECT "id"
  FROM "scoring_schemes"
  WHERE "subject" = 'russian'
    AND "exam_type" = 'ce_ct'
    AND "year" = 2026
    AND "max_raw_score" = 80
    AND "max_scaled_score" = 100
  ORDER BY "created_at" ASC
  LIMIT 1
),
scale("raw_score", "scaled_score") AS (
  VALUES
    (0, 0),
    (1, 1),
    (2, 2),
    (3, 3),
    (4, 4),
    (5, 5),
    (6, 6),
    (7, 7),
    (8, 9),
    (9, 10),
    (10, 12),
    (11, 14),
    (12, 16),
    (13, 18),
    (14, 20),
    (15, 22),
    (16, 23),
    (17, 25),
    (18, 27),
    (19, 28),
    (20, 29),
    (21, 31),
    (22, 32),
    (23, 34),
    (24, 35),
    (25, 36),
    (26, 37),
    (27, 38),
    (28, 39),
    (29, 41),
    (30, 42),
    (31, 43),
    (32, 44),
    (33, 45),
    (34, 46),
    (35, 47),
    (36, 48),
    (37, 49),
    (38, 50),
    (39, 51),
    (40, 52),
    (41, 53),
    (42, 54),
    (43, 55),
    (44, 56),
    (45, 57),
    (46, 58),
    (47, 59),
    (48, 60),
    (49, 61),
    (50, 62),
    (51, 63),
    (52, 64),
    (53, 65),
    (54, 66),
    (55, 67),
    (56, 68),
    (57, 69),
    (58, 70),
    (59, 71),
    (60, 72),
    (61, 73),
    (62, 74),
    (63, 75),
    (64, 76),
    (65, 77),
    (66, 78),
    (67, 79),
    (68, 80),
    (69, 81),
    (70, 82),
    (71, 83),
    (72, 84),
    (73, 85),
    (74, 87),
    (75, 89),
    (76, 90),
    (77, 92),
    (78, 96),
    (79, 98),
    (80, 100)
)
INSERT INTO "scoring_scales" (
  "id",
  "scoring_scheme_id",
  "raw_score",
  "scaled_score",
  "created_at",
  "updated_at"
)
SELECT
  md5('rikz-russian-2026-' || scale."raw_score")::uuid,
  scheme."id",
  scale."raw_score",
  scale."scaled_score",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM scheme
CROSS JOIN scale
WHERE NOT EXISTS (
  SELECT 1
  FROM "scoring_scales"
  WHERE "scoring_scheme_id" = scheme."id"
    AND "raw_score" = scale."raw_score"
);
