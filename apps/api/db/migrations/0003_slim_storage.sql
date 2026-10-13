DROP INDEX "chunks_embedding_idx";--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE halfvec(512);--> statement-breakpoint
-- Chunk text is only needed until it is embedded.
UPDATE "chunks" SET "text" = NULL WHERE "embedding" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" halfvec_cosine_ops);--> statement-breakpoint
ALTER TABLE "films" DROP COLUMN "plot";