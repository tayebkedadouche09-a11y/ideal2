-- 014_company_brain_search.sql
-- Traceable PostgreSQL full-text search indexes for Company Brain evidence retrieval.

CREATE INDEX IF NOT EXISTS idx_knowledge_company_fts
  ON knowledge_item USING GIN (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,''))
  );

CREATE INDEX IF NOT EXISTS idx_lesson_company_fts
  ON lesson_learned USING GIN (
    to_tsvector('simple', coalesce(category,'') || ' ' || coalesce(note,''))
  );

CREATE INDEX IF NOT EXISTS idx_incident_company_fts
  ON incident USING GIN (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))
  );
