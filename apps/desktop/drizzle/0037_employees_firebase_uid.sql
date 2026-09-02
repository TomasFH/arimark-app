-- Track A: campo firebaseUid en employees para vincular carniceros con cuenta Firebase
ALTER TABLE employees ADD COLUMN firebase_uid TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_employees_firebase_uid ON employees (firebase_uid) WHERE firebase_uid IS NOT NULL;
