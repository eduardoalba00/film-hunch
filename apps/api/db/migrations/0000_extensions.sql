-- pgvector, plus join_text: array_to_string is only STABLE, which generated columns don't allow.
-- Joining a text array is deterministic, so this wrapper is declared IMMUTABLE.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE OR REPLACE FUNCTION join_text(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(array_to_string($1, ' '), '') $$;
