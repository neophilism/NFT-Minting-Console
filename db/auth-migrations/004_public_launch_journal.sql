-- Public-only transaction plans: caller explicitly authorizes public deployment/mint calldata storage. Private drafts are never accepted here.
CREATE TABLE nft_console.launch_journal (
  account_id uuid NOT NULL REFERENCES nft_console.accounts(id),
  intent_id text NOT NULL CHECK(intent_id ~ '^0x[0-9a-f]{64}$' AND intent_id <> '0x' || repeat('0',64)),
  chain_id bigint NOT NULL CHECK(chain_id IN (1,11155111,31337)),
  collection text NOT NULL CHECK(collection ~ '^0x[0-9a-f]{40}$' AND collection <> '0x' || repeat('0',40)),
  runtime_code_hash text NOT NULL CHECK(runtime_code_hash ~ '^0x[0-9a-f]{64}$' AND runtime_code_hash <> '0x' || repeat('0',64)),
  public_plan jsonb NOT NULL CHECK(jsonb_typeof(public_plan)='object' AND octet_length(public_plan::text)<=196608),
  state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','wallet_pending','submitted','verified','attention','cancelled')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
  attempt_id uuid,
  transaction_hash text CHECK(transaction_hash ~ '^0x[0-9a-f]{64}$' AND transaction_hash <> '0x' || repeat('0',64)),
  observed_block bigint CHECK(observed_block >= 0 AND observed_block <= 9007199254740991),
  observed_block_hash text CHECK(observed_block_hash ~ '^0x[0-9a-f]{64}$'),
  confirmations integer NOT NULL DEFAULT 0 CHECK(confirmations BETWEEN 0 AND 2147483647),
  last_code text CHECK(last_code ~ '^[A-Z_]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,intent_id),
  CHECK(state <> 'wallet_pending' OR (attempt_id IS NOT NULL AND transaction_hash IS NULL)),
  CHECK(state NOT IN ('submitted','verified') OR transaction_hash IS NOT NULL),
  CHECK(state <> 'verified' OR (observed_block IS NOT NULL AND observed_block_hash IS NOT NULL AND confirmations > 0 AND last_code IS NULL)),
  CHECK(state NOT IN ('prepared','cancelled') OR (transaction_hash IS NULL AND attempt_id IS NULL))
);
REVOKE ALL ON nft_console.launch_journal FROM PUBLIC;
ALTER TABLE nft_console.launch_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE nft_console.launch_journal FORCE ROW LEVEL SECURITY;
GRANT SELECT ON nft_console.launch_journal TO nft_console_api;
GRANT INSERT(account_id,intent_id,chain_id,collection,runtime_code_hash,public_plan) ON nft_console.launch_journal TO nft_console_api;
GRANT UPDATE(state,revision,attempt_id,transaction_hash,observed_block,observed_block_hash,confirmations,last_code,updated_at) ON nft_console.launch_journal TO nft_console_api;
CREATE POLICY launch_journal_read ON nft_console.launch_journal FOR SELECT TO nft_console_api
  USING(account_id=nft_console.current_account_id() AND nft_console.actor_bound()
    AND chain_id=nullif(current_setting('nft_console.chain_id',true),'')::bigint);
CREATE POLICY launch_journal_insert ON nft_console.launch_journal FOR INSERT TO nft_console_api
  WITH CHECK(account_id=nft_console.current_account_id() AND nft_console.actor_bound()
    AND chain_id=nullif(current_setting('nft_console.chain_id',true),'')::bigint
    AND current_setting('nft_console.console_role',true)='owner');
CREATE POLICY launch_journal_update ON nft_console.launch_journal FOR UPDATE TO nft_console_api
  USING(account_id=nft_console.current_account_id() AND nft_console.actor_bound()
    AND chain_id=nullif(current_setting('nft_console.chain_id',true),'')::bigint
    AND current_setting('nft_console.console_role',true)='owner')
  WITH CHECK(account_id=nft_console.current_account_id() AND nft_console.actor_bound()
    AND chain_id=nullif(current_setting('nft_console.chain_id',true),'')::bigint
    AND current_setting('nft_console.console_role',true)='owner');
CREATE FUNCTION nft_console.guard_launch_journal() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF ROW(NEW.account_id,NEW.intent_id,NEW.chain_id,NEW.collection,NEW.runtime_code_hash,NEW.public_plan,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.account_id,OLD.intent_id,OLD.chain_id,OLD.collection,OLD.runtime_code_hash,OLD.public_plan,OLD.created_at)
     OR NEW.revision <> OLD.revision+1 THEN RAISE EXCEPTION 'Immutable mint identity or invalid revision'; END IF;
  IF OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash THEN
    RAISE EXCEPTION 'A recorded transaction cannot be silently replaced'; END IF;
  IF OLD.state='cancelled' OR (NEW.state='cancelled' AND OLD.state<>'prepared') OR
     (NEW.state='wallet_pending' AND OLD.state<>'prepared') OR
     (NEW.state='prepared' AND NOT(OLD.state='wallet_pending' AND NEW.last_code='USER_REJECTED' AND OLD.transaction_hash IS NULL)) THEN
    RAISE EXCEPTION 'Unsafe mint state transition'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nft_console.guard_launch_journal() FROM PUBLIC;
CREATE TRIGGER launch_journal_guard BEFORE UPDATE ON nft_console.launch_journal
  FOR EACH ROW EXECUTE FUNCTION nft_console.guard_launch_journal();

CREATE TABLE nft_console_auth.launch_events (
  account_id uuid NOT NULL, intent_id text NOT NULL, revision bigint NOT NULL,
  state text NOT NULL, attempt_id uuid, transaction_hash text, last_code text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,intent_id,revision),
  FOREIGN KEY(account_id,intent_id) REFERENCES nft_console.launch_journal(account_id,intent_id)
);
REVOKE ALL ON nft_console_auth.launch_events FROM PUBLIC;
ALTER TABLE nft_console_auth.launch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE nft_console_auth.launch_events FORCE ROW LEVEL SECURITY;
GRANT SELECT ON nft_console_auth.launch_events TO nft_console_api;
CREATE POLICY launch_events_read ON nft_console_auth.launch_events FOR SELECT TO nft_console_api
  USING(account_id=nft_console.current_account_id() AND nft_console.actor_bound());
GRANT INSERT ON nft_console_auth.launch_events TO nft_console_acl_reader;
CREATE POLICY launch_events_trigger ON nft_console_auth.launch_events FOR INSERT TO nft_console_acl_reader WITH CHECK(true);
CREATE FUNCTION nft_console.record_launch_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO nft_console_auth.launch_events(account_id,intent_id,revision,state,attempt_id,transaction_hash,last_code)
    VALUES(NEW.account_id,NEW.intent_id,NEW.revision,NEW.state,NEW.attempt_id,NEW.transaction_hash,NEW.last_code);
  RETURN NEW;
END $$;
DO $$ BEGIN
  PERFORM set_config('nft_console.migration_launch_membership_added','no',true);
  IF NOT pg_has_role(current_user,'nft_console_acl_reader','SET') THEN
    EXECUTE format('GRANT nft_console_acl_reader TO %I WITH INHERIT FALSE',current_user);
    PERFORM set_config('nft_console.migration_launch_membership_added','yes',true);
  END IF;
END $$;
GRANT CREATE ON SCHEMA nft_console TO nft_console_acl_reader;
ALTER FUNCTION nft_console.record_launch_event() OWNER TO nft_console_acl_reader;
REVOKE CREATE ON SCHEMA nft_console FROM nft_console_acl_reader;
REVOKE ALL ON FUNCTION nft_console.record_launch_event() FROM PUBLIC;
CREATE TRIGGER launch_journal_event AFTER INSERT OR UPDATE ON nft_console.launch_journal
  FOR EACH ROW EXECUTE FUNCTION nft_console.record_launch_event();
DO $$ BEGIN
  IF current_setting('nft_console.migration_launch_membership_added',true)='yes' THEN
    EXECUTE format('REVOKE nft_console_acl_reader FROM %I',current_user);
  END IF;
END $$;
