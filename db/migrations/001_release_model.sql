-- Private values are opaque client ciphertext. Public values enter only after
-- the separate publication workflow; this schema does not implement encryption.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nft_console_api') THEN
    CREATE ROLE nft_console_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nft_console_api'
             AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'nft_console_api must not have administrative or RLS-bypass privileges';
  END IF;
END $$;

REVOKE ALL ON SCHEMA nft_console FROM PUBLIC;
GRANT USAGE ON SCHEMA nft_console TO nft_console_api;

CREATE DOMAIN nft_console.eth_address AS text
  CHECK (VALUE ~ '^0x[0-9a-f]{40}$');
CREATE DOMAIN nft_console.sha256 AS bytea
  CHECK (octet_length(VALUE) = 32 AND VALUE <> decode(repeat('00', 32), 'hex'));
CREATE DOMAIN nft_console.uint256 AS numeric
  CHECK (VALUE = trunc(VALUE) AND VALUE >= 0 AND VALUE <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);
CREATE DOMAIN nft_console.ipfs_uri AS text
  CHECK (VALUE ~ '^ipfs://[A-Za-z0-9]+(/[^[:space:]]*)?$' AND length(VALUE) <= 2048);

CREATE FUNCTION nft_console.current_account_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT nullif(current_setting('nft_console.account_id', true), '')::uuid;
$$;

CREATE TABLE nft_console.accounts (
  id uuid PRIMARY KEY,
  wallet nft_console.eth_address NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wallet, chain_id)
);

CREATE TABLE nft_console.releases (
  id uuid PRIMARY KEY,
  owner_account_id uuid NOT NULL REFERENCES nft_console.accounts(id),
  workspace_ciphertext bytea NOT NULL CHECK (octet_length(workspace_ciphertext) >= 16),
  workspace_nonce bytea NOT NULL CHECK (octet_length(workspace_nonce) = 12),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN
    ('draft', 'validated', 'published', 'deployed', 'policy-configured', 'minting', 'minting-closed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Permission records are owned by the release owner. Shared-reader/editor
-- enforcement is deliberately closed until PR-09's authenticated RBAC service.
CREATE TABLE nft_console.release_permissions (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  account_id uuid NOT NULL REFERENCES nft_console.accounts(id),
  permission text NOT NULL CHECK (permission IN ('viewer', 'editor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, account_id)
);

CREATE TABLE nft_console.assets (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  object_id uuid NOT NULL UNIQUE,
  manifest_ciphertext bytea NOT NULL CHECK (octet_length(manifest_ciphertext) >= 16),
  manifest_nonce bytea NOT NULL CHECK (octet_length(manifest_nonce) = 12),
  ciphertext_size bigint NOT NULL CHECK (ciphertext_size >= 16),
  upload_state text NOT NULL DEFAULT 'pending' CHECK (upload_state IN ('pending', 'uploading', 'complete', 'abandoned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, id)
);

CREATE TABLE nft_console.editions (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  asset_id uuid NOT NULL,
  edition_number nft_console.uint256 NOT NULL CHECK (edition_number > 0),
  edition_count nft_console.uint256 NOT NULL CHECK (edition_count >= edition_number),
  attributes_ciphertext bytea NOT NULL CHECK (octet_length(attributes_ciphertext) >= 16),
  attributes_nonce bytea NOT NULL CHECK (octet_length(attributes_nonce) = 12),
  UNIQUE (release_id, asset_id, edition_number),
  UNIQUE (release_id, id, asset_id),
  FOREIGN KEY (release_id, asset_id) REFERENCES nft_console.assets(release_id, id)
);

CREATE TABLE nft_console.rights_versions (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  version_number bigint NOT NULL CHECK (version_number > 0),
  document_ciphertext bytea NOT NULL CHECK (octet_length(document_ciphertext) >= 16),
  document_nonce bytea NOT NULL CHECK (octet_length(document_nonce) = 12),
  published_sha256 nft_console.sha256,
  published_uri nft_console.ipfs_uri,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((published_sha256 IS NULL) = (published_uri IS NULL)),
  UNIQUE (release_id, version_number),
  UNIQUE (release_id, id, published_sha256, published_uri)
);

CREATE TABLE nft_console.publications (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  asset_id uuid NOT NULL,
  edition_id uuid,
  rights_version_id uuid NOT NULL,
  token_id nft_console.uint256 NOT NULL CHECK (token_id > 0),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
  media_sha256 nft_console.sha256 NOT NULL,
  rights_sha256 nft_console.sha256 NOT NULL,
  metadata_sha256 nft_console.sha256 NOT NULL,
  media_uri nft_console.ipfs_uri NOT NULL,
  rights_uri nft_console.ipfs_uri NOT NULL,
  metadata_uri nft_console.ipfs_uri NOT NULL,
  consent_digest nft_console.sha256 NOT NULL,
  confirmed_by_account_id uuid NOT NULL REFERENCES nft_console.accounts(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, token_id),
  UNIQUE (release_id, id, token_id),
  FOREIGN KEY (release_id, asset_id) REFERENCES nft_console.assets(release_id, id),
  FOREIGN KEY (release_id, edition_id, asset_id) REFERENCES nft_console.editions(release_id, id, asset_id),
  FOREIGN KEY (release_id, rights_version_id, rights_sha256, rights_uri)
    REFERENCES nft_console.rights_versions(release_id, id, published_sha256, published_uri)
);

CREATE TABLE nft_console.deployment_profiles (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL UNIQUE REFERENCES nft_console.releases(id),
  chain_id bigint NOT NULL CHECK (chain_id IN (31337, 11155111, 1)),
  contract_version text NOT NULL CHECK (length(contract_version) BETWEEN 1 AND 120),
  creation_code_sha256 nft_console.sha256 NOT NULL,
  runtime_code_sha256 nft_console.sha256 NOT NULL,
  constructor_digest nft_console.sha256 NOT NULL,
  collection_name text NOT NULL CHECK (length(collection_name) BETWEEN 1 AND 512),
  symbol text NOT NULL CHECK (length(symbol) BETWEEN 1 AND 64),
  maximum_supply nft_console.uint256 NOT NULL CHECK (maximum_supply > 0),
  royalty_bps integer NOT NULL CHECK (royalty_bps BETWEEN 0 AND 10000),
  owner_wallet nft_console.eth_address NOT NULL CHECK (owner_wallet <> '0x0000000000000000000000000000000000000000'),
  minter_wallet nft_console.eth_address NOT NULL CHECK (minter_wallet <> '0x0000000000000000000000000000000000000000'),
  royalty_wallet nft_console.eth_address NOT NULL CHECK (royalty_wallet <> '0x0000000000000000000000000000000000000000'),
  UNIQUE (release_id, id, chain_id)
);

CREATE TABLE nft_console.transaction_jobs (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  kind text NOT NULL CHECK (kind IN ('deploy', 'policy', 'mint', 'approval', 'listing', 'reconcile')),
  idempotency_key uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN
    ('queued', 'awaiting-signature', 'submitted', 'confirmed', 'failed', 'reconciled')),
  payload_ciphertext bytea NOT NULL CHECK (octet_length(payload_ciphertext) >= 16),
  payload_nonce bytea NOT NULL CHECK (octet_length(payload_nonce) = 12),
  transaction_hash nft_console.sha256,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state NOT IN ('submitted', 'confirmed') OR transaction_hash IS NOT NULL),
  UNIQUE (release_id, kind, idempotency_key),
  UNIQUE (release_id, id)
);

CREATE TABLE nft_console.deployments (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL UNIQUE REFERENCES nft_console.releases(id),
  profile_id uuid NOT NULL UNIQUE,
  job_id uuid NOT NULL,
  chain_id bigint NOT NULL,
  contract_address nft_console.eth_address NOT NULL CHECK (contract_address <> '0x0000000000000000000000000000000000000000'),
  transaction_hash nft_console.sha256 NOT NULL,
  block_hash nft_console.sha256 NOT NULL,
  block_number nft_console.uint256 NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, contract_address),
  UNIQUE (release_id, id),
  FOREIGN KEY (release_id, profile_id, chain_id) REFERENCES nft_console.deployment_profiles(release_id, id, chain_id),
  FOREIGN KEY (release_id, job_id) REFERENCES nft_console.transaction_jobs(release_id, id)
);

CREATE TABLE nft_console.tokens (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  publication_id uuid NOT NULL UNIQUE,
  deployment_id uuid NOT NULL,
  mint_job_id uuid NOT NULL,
  token_id nft_console.uint256 NOT NULL CHECK (token_id > 0),
  minted_to nft_console.eth_address NOT NULL,
  transaction_hash nft_console.sha256 NOT NULL,
  block_hash nft_console.sha256 NOT NULL,
  block_number nft_console.uint256 NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, token_id),
  UNIQUE (release_id, id),
  FOREIGN KEY (release_id, publication_id, token_id) REFERENCES nft_console.publications(release_id, id, token_id),
  FOREIGN KEY (release_id, deployment_id) REFERENCES nft_console.deployments(release_id, id),
  FOREIGN KEY (release_id, mint_job_id) REFERENCES nft_console.transaction_jobs(release_id, id)
);

CREATE TABLE nft_console.listings (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  token_record_id uuid NOT NULL,
  order_hash nft_console.sha256 NOT NULL UNIQUE,
  price_base_units nft_console.uint256 NOT NULL CHECK (price_base_units > 0),
  currency_contract nft_console.eth_address,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, id),
  FOREIGN KEY (release_id, token_record_id) REFERENCES nft_console.tokens(release_id, id)
);

CREATE TABLE nft_console.listing_observations (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  listing_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('submitted', 'active', 'sold', 'expired', 'cancelled', 'unknown')),
  api_verified boolean NOT NULL,
  chain_verified boolean NOT NULL,
  evidence_digest nft_console.sha256 NOT NULL,
  checked_at timestamptz NOT NULL,
  CHECK (state NOT IN ('active', 'sold') OR (api_verified AND chain_verified)),
  FOREIGN KEY (release_id, listing_id) REFERENCES nft_console.listings(release_id, id)
);

CREATE TABLE nft_console.activity_log (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES nft_console.releases(id),
  actor_account_id uuid NOT NULL REFERENCES nft_console.accounts(id),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9.-]{0,63}$'),
  details_ciphertext bytea NOT NULL CHECK (octet_length(details_ciphertext) >= 16),
  details_nonce bytea NOT NULL CHECK (octet_length(details_nonce) = 12),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION nft_console.reject_evidence_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Publication, economic and chain evidence is append-only; record a new observation';
END $$;

CREATE FUNCTION nft_console.protect_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF (to_jsonb(NEW)->'id') IS DISTINCT FROM (to_jsonb(OLD)->'id')
     OR (to_jsonb(NEW)->'release_id') IS DISTINCT FROM (to_jsonb(OLD)->'release_id')
     OR (to_jsonb(NEW)->'owner_account_id') IS DISTINCT FROM (to_jsonb(OLD)->'owner_account_id') THEN
    RAISE EXCEPTION 'Record identity and release ownership cannot be retargeted';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION nft_console.protect_rights_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.published_sha256 IS NOT NULL OR NEW.published_sha256 IS NULL
     OR NEW.document_ciphertext IS DISTINCT FROM OLD.document_ciphertext
     OR NEW.document_nonce IS DISTINCT FROM OLD.document_nonce
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Rights versions are immutable; publication may bind exact final hashes once';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION nft_console.check_token_supply() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, nft_console AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_console.deployment_profiles p
                 WHERE p.release_id = NEW.release_id AND NEW.token_id <= p.maximum_supply) THEN
    RAISE EXCEPTION 'Token ID exceeds the immutable deployment supply';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION nft_console.protect_published_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, nft_console AS $$
BEGIN
  IF TG_TABLE_NAME = 'editions' AND EXISTS (
    SELECT 1 FROM nft_console.publications WHERE edition_id = OLD.id AND release_id = OLD.release_id
  ) THEN
    RAISE EXCEPTION 'Published edition assignments are immutable';
  END IF;
  IF TG_TABLE_NAME = 'assets' AND EXISTS (
    SELECT 1 FROM nft_console.publications WHERE asset_id = OLD.id AND release_id = OLD.release_id
  ) THEN
    RAISE EXCEPTION 'Published asset references are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER published_asset_assignment BEFORE UPDATE ON nft_console.assets
  FOR EACH ROW EXECUTE FUNCTION nft_console.protect_published_assignment();
CREATE TRIGGER published_edition_assignment BEFORE UPDATE ON nft_console.editions
  FOR EACH ROW EXECUTE FUNCTION nft_console.protect_published_assignment();
CREATE TRIGGER rights_version_identity BEFORE UPDATE ON nft_console.rights_versions
  FOR EACH ROW EXECUTE FUNCTION nft_console.protect_identity();
CREATE TRIGGER rights_version_write_once BEFORE UPDATE ON nft_console.rights_versions
  FOR EACH ROW EXECUTE FUNCTION nft_console.protect_rights_version();
CREATE TRIGGER token_supply BEFORE INSERT ON nft_console.tokens
  FOR EACH ROW EXECUTE FUNCTION nft_console.check_token_supply();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['publications','deployment_profiles','deployments','tokens','listings','listing_observations','activity_log'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON nft_console.%I FOR EACH ROW EXECUTE FUNCTION nft_console.reject_evidence_change()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['releases','release_permissions','assets','editions','transaction_jobs'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_identity BEFORE UPDATE ON nft_console.%I FOR EACH ROW EXECUTE FUNCTION nft_console.protect_identity()', t);
  END LOOP;

  ALTER TABLE nft_console.accounts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE nft_console.accounts FORCE ROW LEVEL SECURITY;
  CREATE POLICY account_read ON nft_console.accounts FOR SELECT TO nft_console_api
    USING (id = nft_console.current_account_id());
  GRANT SELECT ON nft_console.accounts TO nft_console_api;

  ALTER TABLE nft_console.releases ENABLE ROW LEVEL SECURITY;
  ALTER TABLE nft_console.releases FORCE ROW LEVEL SECURITY;
  CREATE POLICY owned_release ON nft_console.releases TO nft_console_api
    USING (owner_account_id = nft_console.current_account_id())
    WITH CHECK (owner_account_id = nft_console.current_account_id());
  GRANT SELECT, INSERT, UPDATE ON nft_console.releases TO nft_console_api;

  FOREACH t IN ARRAY ARRAY['release_permissions','assets','editions','rights_versions','publications','deployment_profiles','transaction_jobs','deployments','tokens','listings','listing_observations','activity_log'] LOOP
    EXECUTE format('ALTER TABLE nft_console.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE nft_console.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY owned_release_data ON nft_console.%I TO nft_console_api USING (EXISTS (SELECT 1 FROM nft_console.releases r WHERE r.id = release_id AND r.owner_account_id = nft_console.current_account_id())) WITH CHECK (EXISTS (SELECT 1 FROM nft_console.releases r WHERE r.id = release_id AND r.owner_account_id = nft_console.current_account_id()))', t);
    EXECUTE format('CREATE INDEX ON nft_console.%I (release_id)', t);
    EXECUTE format('GRANT SELECT, INSERT ON nft_console.%I TO nft_console_api', t);
  END LOOP;
END $$;

ALTER POLICY owned_release_data ON nft_console.publications WITH CHECK (
  confirmed_by_account_id = nft_console.current_account_id()
  AND EXISTS (SELECT 1 FROM nft_console.releases r WHERE r.id = release_id AND r.owner_account_id = nft_console.current_account_id())
);
ALTER POLICY owned_release_data ON nft_console.activity_log WITH CHECK (
  actor_account_id = nft_console.current_account_id()
  AND EXISTS (SELECT 1 FROM nft_console.releases r WHERE r.id = release_id AND r.owner_account_id = nft_console.current_account_id())
);

GRANT UPDATE, DELETE ON nft_console.release_permissions, nft_console.assets, nft_console.editions TO nft_console_api;
GRANT UPDATE ON nft_console.rights_versions, nft_console.transaction_jobs TO nft_console_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nft_console FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nft_console.current_account_id() TO nft_console_api;

CREATE INDEX ON nft_console.releases (owner_account_id, state);
CREATE INDEX ON nft_console.transaction_jobs (state, updated_at);
CREATE INDEX ON nft_console.listing_observations (listing_id, checked_at DESC);
