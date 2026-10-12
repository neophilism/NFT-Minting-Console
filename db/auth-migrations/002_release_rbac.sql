-- Extends the checksum-bound baseline without rewriting its migration history.
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['nft_console_identity','nft_console_acl_reader'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',r);
    END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r AND
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)) OR
      EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.member WHERE p.rolname=r) THEN
      RAISE EXCEPTION 'Unsafe identity or ACL helper role';
    END IF;
  END LOOP;
END $$;
-- Neon ownership transfer needs SET membership. Never retain a new helper grant.
DO $$ BEGIN
  PERFORM set_config('nft_console.migration_acl_membership_added','no',true);
  IF NOT pg_has_role(current_user,'nft_console_acl_reader','SET') THEN
    EXECUTE format('GRANT nft_console_acl_reader TO %I WITH INHERIT FALSE',current_user);
    PERFORM set_config('nft_console.migration_acl_membership_added','yes',true);
  END IF;
END $$;
GRANT USAGE ON SCHEMA nft_console TO nft_console_identity,nft_console_acl_reader;
GRANT SELECT,INSERT ON nft_console.accounts TO nft_console_identity;
CREATE POLICY server_identity ON nft_console.accounts TO nft_console_identity USING(true) WITH CHECK(true);
GRANT SELECT ON nft_console.accounts,nft_console.releases,nft_console.release_permissions TO nft_console_acl_reader;
CREATE POLICY acl_accounts ON nft_console.accounts FOR SELECT TO nft_console_acl_reader USING(true);
CREATE POLICY acl_releases ON nft_console.releases FOR SELECT TO nft_console_acl_reader USING(true);
CREATE POLICY acl_permissions ON nft_console.release_permissions FOR SELECT TO nft_console_acl_reader USING(true);

CREATE FUNCTION nft_console.release_access(target uuid,operation text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM nft_console.releases r
    JOIN nft_console.accounts o ON o.id=r.owner_account_id
    JOIN nft_console.accounts a ON a.id=nullif(current_setting('nft_console.account_id',true),'')::uuid
    WHERE r.id=target AND a.chain_id=o.chain_id
      AND a.chain_id=nullif(current_setting('nft_console.chain_id',true),'')::bigint
      AND current_setting('nft_console.console_role',true) IN('owner','editor','viewer')
      AND ((operation='read' AND (a.id=r.owner_account_id OR EXISTS(
        SELECT 1 FROM nft_console.release_permissions p WHERE p.release_id=r.id AND p.account_id=a.id)))
      OR (operation='edit' AND current_setting('nft_console.console_role',true) IN('owner','editor')
        AND r.state='draft' AND (a.id=r.owner_account_id OR EXISTS(
          SELECT 1 FROM nft_console.release_permissions p WHERE p.release_id=r.id AND p.account_id=a.id AND p.permission='editor')))
      OR (operation='owner' AND current_setting('nft_console.console_role',true)='owner' AND a.id=r.owner_account_id)));
$$;
GRANT CREATE ON SCHEMA nft_console TO nft_console_acl_reader;
ALTER FUNCTION nft_console.release_access(uuid,text) OWNER TO nft_console_acl_reader;
REVOKE CREATE ON SCHEMA nft_console FROM nft_console_acl_reader;
REVOKE ALL ON FUNCTION nft_console.release_access(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nft_console.release_access(uuid,text) TO nft_console_api;
CREATE FUNCTION nft_console.actor_bound() RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM nft_console.accounts a WHERE a.id=nft_console.current_account_id()
    AND a.chain_id=nullif(current_setting('nft_console.chain_id',true),'')::bigint)
    AND current_setting('nft_console.console_role',true) IN('owner','editor','viewer');
$$;
REVOKE ALL ON FUNCTION nft_console.actor_bound() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nft_console.actor_bound() TO nft_console_api;
CREATE POLICY shared_release_read ON nft_console.releases FOR SELECT TO nft_console_api USING(nft_console.release_access(id,'read'));
CREATE POLICY shared_release_edit ON nft_console.releases FOR UPDATE TO nft_console_api
  USING(nft_console.release_access(id,'edit')) WITH CHECK(nft_console.release_access(id,'edit'));
-- Direct owner binding also permits INSERT RETURNING before a definer's snapshot
-- can see the newly inserted release. A chain-mismatched account still fails.
CREATE POLICY release_read_gate ON nft_console.releases AS RESTRICTIVE FOR SELECT TO nft_console_api
  USING((owner_account_id=nft_console.current_account_id() AND nft_console.actor_bound()) OR nft_console.release_access(id,'read'));
CREATE POLICY release_create_gate ON nft_console.releases AS RESTRICTIVE FOR INSERT TO nft_console_api
  WITH CHECK(nft_console.actor_bound() AND owner_account_id=nft_console.current_account_id()
    AND current_setting('nft_console.console_role',true)='owner' AND state='draft' AND revision=1);
CREATE POLICY release_update_gate ON nft_console.releases AS RESTRICTIVE FOR UPDATE TO nft_console_api
  USING(nft_console.release_access(id,'edit') OR nft_console.release_access(id,'owner'))
  WITH CHECK(nft_console.release_access(id,'edit') OR nft_console.release_access(id,'owner'));
CREATE FUNCTION nft_console.guard_workspace_edit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF current_user='nft_console_api' THEN
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'Creation time is immutable'; END IF;
    IF NOT nft_console.release_access(OLD.id,'owner') AND NEW.state IS DISTINCT FROM OLD.state THEN
      RAISE EXCEPTION 'Only the owner may change release state';
    END IF;
    IF NEW.workspace_ciphertext IS DISTINCT FROM OLD.workspace_ciphertext OR NEW.workspace_nonce IS DISTINCT FROM OLD.workspace_nonce THEN
      IF OLD.state<>'draft' OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Draft writes require the next revision and a draft release'; END IF;
    ELSIF NEW.revision IS DISTINCT FROM OLD.revision THEN RAISE EXCEPTION 'Revision requires a new draft envelope'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION nft_console.guard_workspace_edit() FROM PUBLIC;
CREATE TRIGGER authorized_workspace_edit BEFORE UPDATE ON nft_console.releases FOR EACH ROW EXECUTE FUNCTION nft_console.guard_workspace_edit();
DO $$ DECLARE t text; permission text; BEGIN
  FOREACH t IN ARRAY ARRAY['assets','editions','rights_versions','publications','deployment_profiles','transaction_jobs','deployments','tokens','listings','listing_observations','activity_log'] LOOP
    permission:=CASE WHEN t IN('assets','editions') THEN 'edit' ELSE 'owner' END;
    EXECUTE format('CREATE POLICY shared_data_read ON nft_console.%I FOR SELECT TO nft_console_api USING(nft_console.release_access(release_id,''read''))',t);
    EXECUTE format('CREATE POLICY data_read_gate ON nft_console.%I AS RESTRICTIVE FOR SELECT TO nft_console_api USING(nft_console.release_access(release_id,''read''))',t);
    IF permission='edit' THEN
      EXECUTE format('CREATE POLICY shared_data_edit ON nft_console.%I TO nft_console_api USING(nft_console.release_access(release_id,''edit'')) WITH CHECK(nft_console.release_access(release_id,''edit''))',t);
    END IF;
    EXECUTE format('CREATE POLICY data_insert_gate ON nft_console.%I AS RESTRICTIVE FOR INSERT TO nft_console_api WITH CHECK(nft_console.release_access(release_id,%L))',t,permission);
    EXECUTE format('CREATE POLICY data_update_gate ON nft_console.%I AS RESTRICTIVE FOR UPDATE TO nft_console_api USING(nft_console.release_access(release_id,%L)) WITH CHECK(nft_console.release_access(release_id,%L))',t,permission,permission);
    EXECUTE format('CREATE POLICY data_delete_gate ON nft_console.%I AS RESTRICTIVE FOR DELETE TO nft_console_api USING(nft_console.release_access(release_id,%L))',t,permission);
  END LOOP;
END $$;
CREATE FUNCTION nft_console.permission_target_same_chain(target uuid,grantee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM nft_console.releases r JOIN nft_console.accounts o ON o.id=r.owner_account_id
    JOIN nft_console.accounts g ON g.id=grantee WHERE r.id=target AND g.chain_id=o.chain_id AND g.id<>o.id);
$$;
GRANT CREATE ON SCHEMA nft_console TO nft_console_acl_reader;
ALTER FUNCTION nft_console.permission_target_same_chain(uuid,uuid) OWNER TO nft_console_acl_reader;
REVOKE CREATE ON SCHEMA nft_console FROM nft_console_acl_reader;
REVOKE ALL ON FUNCTION nft_console.permission_target_same_chain(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nft_console.permission_target_same_chain(uuid,uuid) TO nft_console_api;
CREATE POLICY permission_owner_gate ON nft_console.release_permissions AS RESTRICTIVE TO nft_console_api
  USING(nft_console.release_access(release_id,'owner'))
  WITH CHECK(nft_console.release_access(release_id,'owner') AND nft_console.permission_target_same_chain(release_id,account_id));
CREATE TABLE nft_console_auth.permission_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  actor_account_id uuid NOT NULL REFERENCES nft_console.accounts(id),grantee_account_id uuid NOT NULL REFERENCES nft_console.accounts(id),
  old_permission text CHECK(old_permission IN('viewer','editor')),new_permission text CHECK(new_permission IN('viewer','editor')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(old_permission IS NOT NULL OR new_permission IS NOT NULL)
);
REVOKE ALL ON nft_console_auth.permission_events FROM PUBLIC;
ALTER TABLE nft_console_auth.permission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE nft_console_auth.permission_events FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA nft_console_auth TO nft_console_acl_reader,nft_console_api;
GRANT INSERT ON nft_console_auth.permission_events TO nft_console_acl_reader;
GRANT SELECT ON nft_console_auth.permission_events TO nft_console_api;
CREATE POLICY record_permission_event ON nft_console_auth.permission_events FOR INSERT TO nft_console_acl_reader WITH CHECK(true);
CREATE POLICY owner_permission_events ON nft_console_auth.permission_events FOR SELECT TO nft_console_api USING(nft_console.release_access(release_id,'owner'));
CREATE TRIGGER immutable_permission_event BEFORE UPDATE OR DELETE ON nft_console_auth.permission_events FOR EACH ROW EXECUTE FUNCTION nft_console.reject_evidence_change();
CREATE FUNCTION nft_console.audit_permission_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid; grantee uuid; before_permission text; after_permission text; actor uuid;
BEGIN
  target:=CASE WHEN TG_OP='DELETE' THEN OLD.release_id ELSE NEW.release_id END;
  grantee:=CASE WHEN TG_OP='DELETE' THEN OLD.account_id ELSE NEW.account_id END;
  actor:=nullif(current_setting('nft_console.account_id',true),'')::uuid;
  IF TG_OP='UPDATE' AND (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'Permission identity and creation time are immutable'; END IF;
  IF actor IS NULL OR NOT nft_console.release_access(target,'owner') THEN RAISE EXCEPTION 'Permission changes require the release owner'; END IF;
  IF TG_OP<>'INSERT' THEN before_permission:=OLD.permission; END IF;
  IF TG_OP<>'DELETE' THEN after_permission:=NEW.permission; END IF;
  IF before_permission IS DISTINCT FROM after_permission THEN
    INSERT INTO nft_console_auth.permission_events(release_id,actor_account_id,grantee_account_id,old_permission,new_permission)
      VALUES(target,actor,grantee,before_permission,after_permission);
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
GRANT CREATE ON SCHEMA nft_console TO nft_console_acl_reader;
ALTER FUNCTION nft_console.audit_permission_change() OWNER TO nft_console_acl_reader;
REVOKE CREATE ON SCHEMA nft_console FROM nft_console_acl_reader;
REVOKE ALL ON FUNCTION nft_console.audit_permission_change() FROM PUBLIC;
CREATE TRIGGER permission_audit AFTER INSERT OR UPDATE OR DELETE ON nft_console.release_permissions FOR EACH ROW EXECUTE FUNCTION nft_console.audit_permission_change();
CREATE INDEX ON nft_console_auth.permission_events(release_id,occurred_at DESC,id);
DO $$ BEGIN
  IF current_setting('nft_console.migration_acl_membership_added',true)='yes' THEN
    EXECUTE format('REVOKE nft_console_acl_reader FROM %I',current_user);
  END IF;
END $$;
