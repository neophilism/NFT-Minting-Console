-- Only synthetic fixtures; the subtransaction rolls every fixture back.
CREATE OR REPLACE FUNCTION pg_temp.nft_authorization_acceptance() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid();
  r uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); n integer; checks integer:=0; denied boolean;
BEGIN
  BEGIN
    SET LOCAL ROLE nft_console_identity;
    INSERT INTO nft_console.accounts(id,wallet,chain_id) VALUES
      (a,'0x1111111111111111111111111111111111111111',11155111),
      (b,'0x2222222222222222222222222222222222222222',11155111),
      (c,'0x3333333333333333333333333333333333333333',11155111),
      (d,'0x1111111111111111111111111111111111111111',1);
    SET LOCAL ROLE nft_console_api;
    PERFORM set_config('nft_console.account_id',a::text,true);
    PERFORM set_config('nft_console.chain_id','11155111',true);
    PERFORM set_config('nft_console.console_role','owner',true);
    INSERT INTO nft_console.releases(id,owner_account_id,workspace_ciphertext,workspace_nonce)
      VALUES(r,a,decode(repeat('81',32),'hex'),decode(repeat('92',12),'hex')) RETURNING 1 INTO n;
    IF n<>1 THEN RAISE EXCEPTION 'Owner create/return failed'; END IF; checks:=checks+1;
    INSERT INTO nft_console.release_permissions(id,release_id,account_id,permission) VALUES(p,r,b,'viewer');
    SELECT count(*) INTO n FROM nft_console_auth.permission_events WHERE release_id=r;
    IF n<>1 THEN RAISE EXCEPTION 'Grant audit missing'; END IF; checks:=checks+1;
    PERFORM set_config('nft_console.account_id',c::text,true);
    SELECT count(*) INTO n FROM nft_console.releases WHERE id=r;
    IF n<>0 THEN RAISE EXCEPTION 'Unrelated owner can read release'; END IF; checks:=checks+1;
    PERFORM set_config('nft_console.account_id',b::text,true);
    PERFORM set_config('nft_console.console_role','viewer',true);
    SELECT count(*) INTO n FROM nft_console.releases WHERE id=r;
    IF n<>1 THEN RAISE EXCEPTION 'Granted viewer cannot read'; END IF; checks:=checks+1;
    UPDATE nft_console.releases SET workspace_ciphertext=decode(repeat('82',32),'hex'),revision=revision+1 WHERE id=r;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>0 THEN RAISE EXCEPTION 'Viewer changed draft'; END IF; checks:=checks+1;
    SELECT count(*) INTO n FROM nft_console_auth.permission_events WHERE release_id=r;
    IF n<>0 THEN RAISE EXCEPTION 'Viewer read owner audit'; END IF; checks:=checks+1;
    denied:=false;
    BEGIN INSERT INTO nft_console.releases(id,owner_account_id,workspace_ciphertext,workspace_nonce)
      VALUES(gen_random_uuid(),b,decode(repeat('81',32),'hex'),decode(repeat('92',12),'hex'));
    EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Viewer created release'; END IF; checks:=checks+1;
    PERFORM set_config('nft_console.console_role','editor',true);
    UPDATE nft_console.releases SET workspace_ciphertext=decode(repeat('82',32),'hex'),revision=revision+1 WHERE id=r;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>0 THEN RAISE EXCEPTION 'Console editor bypassed viewer grant'; END IF; checks:=checks+1;
    PERFORM set_config('nft_console.account_id',a::text,true);
    PERFORM set_config('nft_console.console_role','owner',true);
    UPDATE nft_console.release_permissions SET permission='editor' WHERE id=p;
    PERFORM set_config('nft_console.account_id',b::text,true);
    PERFORM set_config('nft_console.console_role','editor',true);
    UPDATE nft_console.releases SET workspace_ciphertext=decode(repeat('82',32),'hex'),revision=2 WHERE id=r AND revision=1;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 THEN RAISE EXCEPTION 'Granted editor cannot update'; END IF; checks:=checks+1;
    UPDATE nft_console.releases SET workspace_ciphertext=decode(repeat('83',32),'hex'),revision=2 WHERE id=r AND revision=1;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>0 THEN RAISE EXCEPTION 'Stale revision overwritten'; END IF; checks:=checks+1;
    denied:=false;
    BEGIN UPDATE nft_console.releases SET state='published' WHERE id=r;
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN denied:=true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Editor published release'; END IF; checks:=checks+1;
    denied:=false;
    BEGIN INSERT INTO nft_console.release_permissions(id,release_id,account_id,permission) VALUES(gen_random_uuid(),r,c,'editor');
    EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Editor granted access'; END IF; checks:=checks+1;
    PERFORM set_config('nft_console.account_id',a::text,true);
    PERFORM set_config('nft_console.console_role','owner',true);
    denied:=false;
    BEGIN INSERT INTO nft_console.release_permissions(id,release_id,account_id,permission) VALUES(gen_random_uuid(),r,d,'viewer');
    EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Cross-chain grant accepted'; END IF; checks:=checks+1;
    UPDATE nft_console.release_permissions SET permission='editor' WHERE id=p;
    SELECT count(*) INTO n FROM nft_console_auth.permission_events WHERE release_id=r;
    IF n<>2 THEN RAISE EXCEPTION 'Idempotent grant duplicate audit'; END IF; checks:=checks+1;
    DELETE FROM nft_console.release_permissions WHERE id=p;
    SELECT count(*) INTO n FROM nft_console_auth.permission_events WHERE release_id=r;
    IF n<>3 THEN RAISE EXCEPTION 'Revoke audit missing'; END IF; checks:=checks+1;
    PERFORM set_config('nft_console.account_id',b::text,true);
    SELECT count(*) INTO n FROM nft_console.releases WHERE id=r;
    IF n<>0 THEN RAISE EXCEPTION 'Revoked account still sees release'; END IF; checks:=checks+1;
    PERFORM set_config('nft_console.account_id',a::text,true);
    PERFORM set_config('nft_console.chain_id','1',true);
    SELECT count(*) INTO n FROM nft_console.releases WHERE id=r;
    IF n<>0 THEN RAISE EXCEPTION 'Wrong chain reused account'; END IF; checks:=checks+1;
    PERFORM set_config('nft_console.account_id','',true);
    SELECT count(*) INTO n FROM nft_console.releases WHERE id=r;
    IF n<>0 THEN RAISE EXCEPTION 'Unbound session sees release'; END IF; checks:=checks+1;
    PERFORM set_config('nft_console.account_id',a::text,true);
    PERFORM set_config('nft_console.chain_id','11155111',true);
    PERFORM set_config('nft_console.console_role','owner',true);
    denied:=false;
    BEGIN UPDATE nft_console_auth.permission_events SET new_permission='viewer' WHERE release_id=r;
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN denied:=true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Audit is mutable'; END IF; checks:=checks+1;
    UPDATE nft_console.releases SET state='published' WHERE id=r;
    denied:=false;
    BEGIN UPDATE nft_console.releases SET workspace_ciphertext=decode(repeat('83',32),'hex'),revision=3 WHERE id=r;
    EXCEPTION WHEN raise_exception THEN denied:=true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Published workspace rewritten'; END IF; checks:=checks+1;
    RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='rollback successful fixtures';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
  END;
  RETURN checks;
END $$;
SELECT pg_temp.nft_authorization_acceptance() AS passed_checks;
