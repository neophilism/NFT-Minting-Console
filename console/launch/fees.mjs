/** One fee policy for the wallet review and read-only operator estimate. */
export const LAUNCH_FEE_LIMITS=Object.freeze({minimumGas:21000n,maximumGas:12000000n,maximumGasPrice:1000000000000n,maximumCost:100000000000000000n});
export function launchFeeBudget(estimatedGas,gasPrice,balance){
  if([estimatedGas,gasPrice,balance].some(value=>typeof value!=='bigint'||value<0n))throw new Error('Invalid fee observation.');
  const gas=(estimatedGas*120n+99n)/100n,cost=gas*gasPrice;
  return Object.freeze({gasLimit:String(gas),gasPrice:String(gasPrice),maximumCostWei:String(cost),balanceWei:String(balance),
    additionalWei:String(cost>balance?cost-balance:0n),funded:balance>=cost,
    withinLimits:gas>=LAUNCH_FEE_LIMITS.minimumGas&&gas<=LAUNCH_FEE_LIMITS.maximumGas&&gasPrice>=1n&&gasPrice<=LAUNCH_FEE_LIMITS.maximumGasPrice&&cost<=LAUNCH_FEE_LIMITS.maximumCost});
}
