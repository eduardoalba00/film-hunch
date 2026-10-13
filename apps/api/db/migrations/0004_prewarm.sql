-- Lets the web server reload the search indexes into the database's cache after it wakes up.
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
