import { authRealm } from './postgres.mjs';
/** Operator-only, preview by default, never an HTTP route. */
export async function rotateAuthPolicy(client,{origin,chainId,roles,apply=false,expectedPolicyDigest}) {
  if(typeof apply!=='boolean' || (apply && !/^[a-f0-9]{64}$/.test(expectedPolicyDigest || ''))) throw new Error('Applying requires the exact inspected policy digest.');
  const next=authRealm(origin,chainId,roles); await client.query('BEGIN');
  try {
    await client.query('SET LOCAL statement_timeout = 10000');
    await client.query('SET LOCAL lock_timeout = 5000');
    await client.query('SET LOCAL ROLE nft_console_auth_service');
    const found=await client.query('SELECT policy_digest FROM nft_console_auth.realms WHERE id=$1 FOR UPDATE',[next.realmId]);
    const current=found.rows[0]?.policy_digest; if(!current) throw new Error('No initialized authentication realm.');
    if(apply && current!==expectedPolicyDigest) throw new Error('Policy changed since preview. Inspect it again.');
    const counts=await client.query('SELECT (SELECT count(*)::integer FROM nft_console_auth.sessions WHERE realm_id=$1) AS sessions,(SELECT count(*)::integer FROM nft_console_auth.challenges WHERE realm_id=$1) AS challenges',[next.realmId]);
    const changed=current!==next.policyDigest;
    if(apply && changed) {
      await client.query('DELETE FROM nft_console_auth.sessions WHERE realm_id=$1',[next.realmId]);
      await client.query('DELETE FROM nft_console_auth.challenges WHERE realm_id=$1',[next.realmId]);
      await client.query('DELETE FROM nft_console_auth.rate_limits WHERE realm_id=$1',[next.realmId]);
      await client.query('UPDATE nft_console_auth.realms SET policy_digest=$2 WHERE id=$1',[next.realmId,next.policyDigest]);
    }
    await client.query('COMMIT');
    return {realmId:next.realmId,currentPolicyDigest:current,nextPolicyDigest:next.policyDigest,changed,applied:apply&&changed,affected:counts.rows[0]};
  } catch(error) {await client.query('ROLLBACK');throw error;}
}
