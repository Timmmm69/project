-- Clean up raw provider payloads from legacy payment records
-- Per B3-04 policy: only allowlisted normalized data + safe hash permitted
-- Historical raw payloads are sanitized to prevent persistence of PAN, CVV, expiry, 3DS, signatures, secrets, etc.
UPDATE payments SET provider_payload_json = NULL, provider_webhook_payload_json = NULL;
