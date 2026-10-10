CREATE TRIGGER rights_versions_append_only_update
BEFORE UPDATE ON rights_versions BEGIN
    SELECT RAISE(ABORT, 'rights versions are append-only');
END;

CREATE TRIGGER rights_versions_append_only_delete
BEFORE DELETE ON rights_versions BEGIN
    SELECT RAISE(ABORT, 'rights versions are append-only');
END;

CREATE TRIGGER published_assets_immutable
BEFORE UPDATE ON assets
WHEN OLD.published_uri IS NOT NULL AND (
    NEW.release_id IS NOT OLD.release_id OR
    NEW.kind IS NOT OLD.kind OR
    NEW.plaintext_sha256 IS NOT OLD.plaintext_sha256 OR
    NEW.byte_length IS NOT OLD.byte_length OR
    NEW.media_type IS NOT OLD.media_type OR
    NEW.published_uri IS NOT OLD.published_uri
) BEGIN
    SELECT RAISE(ABORT, 'published asset evidence is immutable');
END;

CREATE TRIGGER token_records_immutable_update
BEFORE UPDATE ON token_records BEGIN
    SELECT RAISE(ABORT, 'token records are immutable');
END;

CREATE TRIGGER token_records_immutable_delete
BEFORE DELETE ON token_records BEGIN
    SELECT RAISE(ABORT, 'token records are immutable');
END;

CREATE TRIGGER deployment_profiles_immutable_update
BEFORE UPDATE ON deployment_profiles BEGIN
    SELECT RAISE(ABORT, 'deployment profiles are immutable');
END;

CREATE TRIGGER deployment_profiles_immutable_delete
BEFORE DELETE ON deployment_profiles BEGIN
    SELECT RAISE(ABORT, 'deployment profiles are immutable');
END;

CREATE TRIGGER activity_log_append_only_update
BEFORE UPDATE ON activity_log BEGIN
    SELECT RAISE(ABORT, 'activity log is append-only');
END;

CREATE TRIGGER activity_log_append_only_delete
BEFORE DELETE ON activity_log BEGIN
    SELECT RAISE(ABORT, 'activity log is append-only');
END;
