-- =============================================================
-- V6__widen_documents_file_type.sql  —  FR-070 (Document Checklist & Upload)
-- Module: M8 KYC & Documents.  source_fr: FR-070 (Tier 3).
--
-- documents.file_type stores the document's MIME type (e.g. 'application/pdf',
-- 'image/jpeg'). The original VARCHAR(10) is too narrow for 'application/pdf'
-- (15 chars) — the longest of the allowed types — which forced a lossy truncate
-- on insert and broke the FR-070 Phase-B content-MIME inspection (the stored,
-- truncated value never matched the real GCS object content type). Widen to
-- VARCHAR(255) so the full MIME type round-trips through storage, the API
-- response (LLD §Endpoint 1/2), and the inspection comparison unchanged.
--
-- Safe: widening a VARCHAR length is a metadata-only change in PostgreSQL (no
-- table rewrite, no data loss). Idempotent at the column-type level.
-- =============================================================

ALTER TABLE documents
  ALTER COLUMN file_type TYPE VARCHAR(255);
