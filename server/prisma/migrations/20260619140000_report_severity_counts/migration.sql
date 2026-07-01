-- AlterTable: denormalized per-severity issue counts on QAReport.
ALTER TABLE "QAReport" ADD COLUMN "sevCritical" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QAReport" ADD COLUMN "sevHigh" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QAReport" ADD COLUMN "sevMedium" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QAReport" ADD COLUMN "sevLow" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QAReport" ADD COLUMN "sevInfo" INTEGER NOT NULL DEFAULT 0;

-- Backfill from the existing issuesBySeverity JSON blob (only for rows that
-- actually hold valid JSON; null / malformed stays at the default 0).
UPDATE "QAReport"
SET
  "sevCritical" = CAST(COALESCE(json_extract("issuesBySeverity", '$.critical'), 0) AS INTEGER),
  "sevHigh"     = CAST(COALESCE(json_extract("issuesBySeverity", '$.high'),     0) AS INTEGER),
  "sevMedium"   = CAST(COALESCE(json_extract("issuesBySeverity", '$.medium'),   0) AS INTEGER),
  "sevLow"      = CAST(COALESCE(json_extract("issuesBySeverity", '$.low'),      0) AS INTEGER),
  "sevInfo"     = CAST(COALESCE(json_extract("issuesBySeverity", '$.info'),     0) AS INTEGER)
WHERE "issuesBySeverity" IS NOT NULL AND json_valid("issuesBySeverity");
