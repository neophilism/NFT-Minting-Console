CREATE TABLE releases (
    id TEXT PRIMARY KEY,
    owner_wallet TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('draft','validated','published','deployed','policy_configured','minting','listed','sold','archived')),
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    maximum_supply INTEGER NOT NULL CHECK (maximum_supply > 0),
    royalty_bps INTEGER NOT NULL CHECK (royalty_bps BETWEEN 0 AND 10000),
    royalty_recipient TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX releases_owner_state ON releases(owner_wallet, state);

CREATE TABLE rights_versions (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
    media_type TEXT NOT NULL,
    public_uri TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (release_id, version),
    UNIQUE (release_id, id),
    FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('media','poster','metadata','rights','other')),
    ciphertext_sha256 TEXT CHECK (ciphertext_sha256 IS NULL OR (length(ciphertext_sha256) = 64 AND ciphertext_sha256 NOT GLOB '*[^0-9a-f]*')),
    plaintext_sha256 TEXT CHECK (plaintext_sha256 IS NULL OR (length(plaintext_sha256) = 64 AND plaintext_sha256 NOT GLOB '*[^0-9a-f]*')),
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
    media_type TEXT NOT NULL,
    storage_locator TEXT,
    published_uri TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (release_id, id),
    FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE editions (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL,
    edition_key TEXT NOT NULL,
    title TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TEXT NOT NULL,
    UNIQUE (release_id, edition_key),
    UNIQUE (release_id, id),
    FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE token_records (
    release_id TEXT NOT NULL,
    token_id INTEGER NOT NULL CHECK (token_id > 0),
    edition_id TEXT NOT NULL,
    title TEXT NOT NULL,
    metadata_uri TEXT NOT NULL,
    media_sha256 TEXT NOT NULL CHECK (length(media_sha256) = 64 AND media_sha256 NOT GLOB '*[^0-9a-f]*'),
    rights_version_id TEXT NOT NULL,
    rights_sha256 TEXT NOT NULL CHECK (length(rights_sha256) = 64 AND rights_sha256 NOT GLOB '*[^0-9a-f]*'),
    minted_transaction_hash TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (release_id, token_id),
    FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
    FOREIGN KEY (release_id, edition_id) REFERENCES editions(release_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (release_id, rights_version_id) REFERENCES rights_versions(release_id, id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE transaction_jobs (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('deploy','configure_policy','mint','approve','list','cancel_listing','reconcile')),
    state TEXT NOT NULL CHECK (state IN ('queued','awaiting_signature','submitted','confirmed','failed','reconciled')),
    request_key TEXT NOT NULL,
    chain_id INTEGER NOT NULL CHECK (chain_id > 0),
    transaction_hash TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (release_id, request_key),
    FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE listings (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL,
    token_id INTEGER NOT NULL,
    marketplace TEXT NOT NULL,
    external_order_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','active','sold','expired','cancelled','invalid')),
    price_wei TEXT NOT NULL CHECK (price_wei NOT GLOB '*[^0-9]*'),
    seller_wallet TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (marketplace, external_order_id),
    FOREIGN KEY (release_id, token_id) REFERENCES token_records(release_id, token_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE deployment_profiles (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL,
    chain_id INTEGER NOT NULL CHECK (chain_id > 0),
    factory_address TEXT NOT NULL,
    factory_version TEXT NOT NULL,
    collection_creation_code_id TEXT NOT NULL,
    collection_address TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    init_code_hash TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    block_number INTEGER NOT NULL CHECK (block_number >= 0),
    created_at TEXT NOT NULL,
    UNIQUE (release_id, chain_id),
    UNIQUE (chain_id, collection_address),
    FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE activity_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id TEXT NOT NULL,
    actor_wallet TEXT NOT NULL,
    action TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX assets_release ON assets(release_id);
CREATE INDEX tokens_release ON token_records(release_id);
CREATE INDEX jobs_release_state ON transaction_jobs(release_id, state);
CREATE INDEX listings_release_status ON listings(release_id, status);
CREATE INDEX activity_release_sequence ON activity_log(release_id, sequence);
