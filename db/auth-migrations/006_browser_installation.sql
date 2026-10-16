-- A setup code plus a domain-bound wallet proof claims an installation once.
-- No application role may rewrite or delete this claim.
CREATE TABLE nft_console_auth.installations (
  id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
  origin text NOT NULL UNIQUE CHECK(length(origin) BETWEEN 8 AND 2048),
  chain_id bigint NOT NULL CHECK(chain_id IN (1,11155111,31337)),
  admin_wallet text NOT NULL CHECK(admin_wallet ~ '^0x[0-9a-f]{40}$' AND admin_wallet <> '0x' || repeat('0',40)),
  setup_key_digest text NOT NULL CHECK(setup_key_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nft_console_auth.installation_challenges (
  installation_id text NOT NULL CHECK(installation_id ~ '^[a-f0-9]{64}$'),
  id text NOT NULL CHECK(id ~ '^[a-f0-9]{64}$'),
  binding_hash text NOT NULL CHECK(binding_hash ~ '^[a-f0-9]{64}$'),
  key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),
  wallet text NOT NULL CHECK(wallet ~ '^0x[0-9a-f]{40}$'),
  message text NOT NULL CHECK(octet_length(message) BETWEEN 100 AND 4096),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(installation_id,id)
);
REVOKE ALL ON nft_console_auth.installations,nft_console_auth.installation_challenges FROM PUBLIC;
GRANT SELECT,INSERT ON nft_console_auth.installations TO nft_console_auth_service;
GRANT SELECT,INSERT,DELETE ON nft_console_auth.installation_challenges TO nft_console_auth_service;
CREATE INDEX ON nft_console_auth.installation_challenges(expires_at);
