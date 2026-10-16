-- Immutable recovery evidence. Never replace or erase the original transaction hash.
CREATE TABLE nft_console.launch_nonce_resolutions (
  account_id uuid NOT NULL,
  intent_id text NOT NULL,
  chain_id bigint NOT NULL CHECK(chain_id IN (1,11155111,31337)),
  proof jsonb NOT NULL CHECK(jsonb_typeof(proof)='object' AND octet_length(proof::text)<=4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,intent_id),
  FOREIGN KEY(account_id,intent_id) REFERENCES nft_console.launch_journal(account_id,intent_id),
  CHECK((proof ?& ARRAY['version','kind','chainId','wallet','nonce','transactionHash','blockNumber','blockHash','finalizedBlockNumber','finalizedBlockHash','confirmations','originalActionVerified','transactionSent']
    AND proof - ARRAY['version','kind','chainId','wallet','nonce','transactionHash','blockNumber','blockHash','finalizedBlockNumber','finalizedBlockHash','confirmations','originalActionVerified','transactionSent'] = '{}'::jsonb
    AND proof->>'version'='1' AND proof->>'kind'='finalized-self-cancellation'
    AND proof->>'chainId'=chain_id::text AND proof->>'originalActionVerified'='false'
    AND proof->>'transactionSent'='false') IS TRUE)
);
REVOKE ALL ON nft_console.launch_nonce_resolutions FROM PUBLIC;
ALTER TABLE nft_console.launch_nonce_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nft_console.launch_nonce_resolutions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON nft_console.launch_nonce_resolutions TO nft_console_api;
GRANT INSERT(account_id,intent_id,chain_id,proof) ON nft_console.launch_nonce_resolutions TO nft_console_api;
CREATE POLICY launch_nonce_resolution_read ON nft_console.launch_nonce_resolutions FOR SELECT TO nft_console_api
  USING(account_id=nft_console.current_account_id() AND nft_console.actor_bound()
    AND chain_id=nullif(current_setting('nft_console.chain_id',true),'')::bigint);
CREATE POLICY launch_nonce_resolution_insert ON nft_console.launch_nonce_resolutions FOR INSERT TO nft_console_api
  WITH CHECK(account_id=nft_console.current_account_id() AND nft_console.actor_bound()
    AND chain_id=nullif(current_setting('nft_console.chain_id',true),'')::bigint
    AND current_setting('nft_console.console_role',true)='owner'
    AND EXISTS(SELECT 1 FROM nft_console.launch_journal j WHERE j.account_id=launch_nonce_resolutions.account_id
      AND j.intent_id=launch_nonce_resolutions.intent_id AND j.chain_id=launch_nonce_resolutions.chain_id
      AND j.state='attention' AND j.last_code='NONCE_CANCELLED'));
