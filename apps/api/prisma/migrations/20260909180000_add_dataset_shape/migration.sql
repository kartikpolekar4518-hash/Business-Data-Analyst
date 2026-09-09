-- The structural read of a dataset (engine/shape.ts): which columns are time, measures,
-- dimensions and identifiers, with the confidence and reasons behind each call.
-- Nullable: datasets ingested before this migration derive their shape on read.
ALTER TABLE "Dataset" ADD COLUMN "shape" JSONB;
