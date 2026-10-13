-- Abandoned uploads (a ticket was issued, the file never arrived) are marked EXPIRED by the hourly sweep.
-- Rows are kept: the register shows that an upload was attempted, and by whom.
ALTER TABLE platform.documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE platform.documents ADD CONSTRAINT documents_status_check CHECK (status IN ('PENDING', 'STORED', 'EXPIRED'));
CREATE INDEX IF NOT EXISTS documents_pending ON platform.documents (created_at) WHERE status = 'PENDING';
