-- Service authorization records, not creative drafts or an E2EE implementation.
CREATE SCHEMA IF NOT EXISTS nft_console_auth;
REVOKE ALL ON SCHEMA nft_console_auth FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nft_console_auth_service') THEN
    CREATE ROLE nft_console_auth_service NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nft_console_auth_service' AND
    (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)) OR
    EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nft_console_auth_service') THEN
    RAISE EXCEPTION 'Unsafe authentication service role';
  END IF;
END $$;
GRANT USAGE ON SCHEMA nft_console_auth TO nft_console_auth_service;
CREATE TABLE nft_console_auth.realms(
  id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
  origin text NOT NULL CHECK(length(origin) BETWEEN 1 AND 2048),
  chain_id bigint NOT NULL CHECK(chain_id IN(1,11155111,31337)),
  policy_digest text NOT NULL CHECK(policy_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(origin,chain_id)
);
CREATE TABLE nft_console_auth.challenges(
  realm_id text NOT NULL REFERENCES nft_console_auth.realms(id),
  id text NOT NULL CHECK(id ~ '^[a-f0-9]{64}$'),
  binding_hash text NOT NULL CHECK(binding_hash ~ '^[a-f0-9]{64}$'),
  expires_ms bigint NOT NULL CHECK(expires_ms>0),
  record jsonb NOT NULL CHECK(jsonb_typeof(record)='object' AND octet_length(record::text)<=8192),
  PRIMARY KEY(realm_id,id)
);
CREATE TABLE nft_console_auth.sessions(
  realm_id text NOT NULL REFERENCES nft_console_auth.realms(id),
  id text NOT NULL CHECK(id ~ '^[a-f0-9]{64}$'),
  expires_ms bigint NOT NULL CHECK(expires_ms>0),
  idle_expires_ms bigint NOT NULL CHECK(idle_expires_ms>0 AND idle_expires_ms<=expires_ms),
  record jsonb NOT NULL CHECK(jsonb_typeof(record)='object' AND octet_length(record::text)<=49152),
  PRIMARY KEY(realm_id,id)
);
CREATE TABLE nft_console_auth.rate_limits(
  realm_id text NOT NULL REFERENCES nft_console_auth.realms(id),
  id text NOT NULL CHECK(id ~ '^[a-f0-9]{64}$'),count integer NOT NULL CHECK(count>0),
  expires_ms bigint NOT NULL CHECK(expires_ms>0),PRIMARY KEY(realm_id,id)
);
CREATE INDEX ON nft_console_auth.challenges(realm_id,expires_ms);
CREATE INDEX ON nft_console_auth.sessions(realm_id,expires_ms,idle_expires_ms);
CREATE INDEX ON nft_console_auth.rate_limits(realm_id,expires_ms);
-- UPDATE on realms is required for row locks and explicit operator policy rotation.
GRANT SELECT,INSERT,UPDATE ON nft_console_auth.realms TO nft_console_auth_service;
GRANT SELECT,INSERT,UPDATE,DELETE ON nft_console_auth.challenges,nft_console_auth.sessions,nft_console_auth.rate_limits TO nft_console_auth_service;
REVOKE ALL ON ALL TABLES IN SCHEMA nft_console_auth FROM PUBLIC;
