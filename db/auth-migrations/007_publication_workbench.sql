-- Explicit public-only file commitments and upload recovery. Never private drafts or tokens.
CREATE TABLE nft_console.public_workbench (
  account_id uuid NOT NULL REFERENCES nft_console.accounts(id), id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK(chain_id IN(1,11155111,31337)),
  public_plan jsonb NOT NULL CHECK(jsonb_typeof(public_plan)='object' AND octet_length(public_plan::text)<=65536),
  metadata_json text CHECK(octet_length(metadata_json)<=131072),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(account_id,id)
);
CREATE TABLE nft_console.public_upload_slots (
  account_id uuid NOT NULL, work_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN('image','media','rights','metadata')),
  descriptor jsonb NOT NULL CHECK(jsonb_typeof(descriptor)='object' AND octet_length(descriptor::text)<=2048),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
  issued_at timestamptz, candidate_uri text CHECK(length(candidate_uri)<=2048),
  verified_uri text CHECK(length(verified_uri)<=2048),
  PRIMARY KEY(account_id,work_id,kind), FOREIGN KEY(account_id,work_id) REFERENCES nft_console.public_workbench(account_id,id),
  CHECK(verified_uri IS NULL OR verified_uri=candidate_uri)
);
REVOKE ALL ON nft_console.public_workbench,nft_console.public_upload_slots FROM PUBLIC;
ALTER TABLE nft_console.public_workbench ENABLE ROW LEVEL SECURITY;
ALTER TABLE nft_console.public_workbench FORCE ROW LEVEL SECURITY;
ALTER TABLE nft_console.public_upload_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE nft_console.public_upload_slots FORCE ROW LEVEL SECURITY;
GRANT SELECT ON nft_console.public_workbench,nft_console.public_upload_slots TO nft_console_api;
GRANT INSERT(account_id,id,chain_id,public_plan),UPDATE(metadata_json) ON nft_console.public_workbench TO nft_console_api;
GRANT INSERT(account_id,work_id,kind,descriptor),UPDATE(attempts,issued_at,candidate_uri,verified_uri) ON nft_console.public_upload_slots TO nft_console_api;
CREATE POLICY public_workbench_owner ON nft_console.public_workbench TO nft_console_api
  USING(account_id=nft_console.current_account_id() AND nft_console.actor_bound() AND chain_id=nullif(current_setting('nft_console.chain_id',true),'')::bigint AND current_setting('nft_console.console_role',true)='owner')
  WITH CHECK(account_id=nft_console.current_account_id() AND nft_console.actor_bound() AND chain_id=nullif(current_setting('nft_console.chain_id',true),'')::bigint AND current_setting('nft_console.console_role',true)='owner');
CREATE POLICY public_slots_owner ON nft_console.public_upload_slots TO nft_console_api
  USING(account_id=nft_console.current_account_id() AND EXISTS(SELECT 1 FROM nft_console.public_workbench w WHERE w.account_id=public_upload_slots.account_id AND w.id=work_id))
  WITH CHECK(account_id=nft_console.current_account_id() AND EXISTS(SELECT 1 FROM nft_console.public_workbench w WHERE w.account_id=public_upload_slots.account_id AND w.id=work_id));
CREATE FUNCTION nft_console.guard_publication_workbench() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='public_workbench' THEN
    IF ROW(NEW.account_id,NEW.id,NEW.chain_id,NEW.public_plan,NEW.created_at) IS DISTINCT FROM ROW(OLD.account_id,OLD.id,OLD.chain_id,OLD.public_plan,OLD.created_at)
      OR (OLD.metadata_json IS NOT NULL AND NEW.metadata_json IS DISTINCT FROM OLD.metadata_json) THEN RAISE EXCEPTION 'Public work commitments are immutable'; END IF;
  ELSE
    IF ROW(NEW.account_id,NEW.work_id,NEW.kind,NEW.descriptor) IS DISTINCT FROM ROW(OLD.account_id,OLD.work_id,OLD.kind,OLD.descriptor)
      OR (OLD.verified_uri IS NOT NULL AND NEW IS DISTINCT FROM OLD)
      OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 THEN RAISE EXCEPTION 'Verified file commitments are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nft_console.guard_publication_workbench() FROM PUBLIC;
CREATE TRIGGER immutable_public_work BEFORE UPDATE ON nft_console.public_workbench FOR EACH ROW EXECUTE FUNCTION nft_console.guard_publication_workbench();
CREATE TRIGGER immutable_public_slot BEFORE UPDATE ON nft_console.public_upload_slots FOR EACH ROW EXECUTE FUNCTION nft_console.guard_publication_workbench();
