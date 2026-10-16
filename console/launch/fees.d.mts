export const LAUNCH_FEE_LIMITS:Readonly<{minimumGas:bigint;maximumGas:bigint;maximumGasPrice:bigint;maximumCost:bigint}>;
export function launchFeeBudget(estimatedGas:bigint,gasPrice:bigint,balance:bigint):Readonly<{gasLimit:string;gasPrice:string;maximumCostWei:string;balanceWei:string;additionalWei:string;funded:boolean;withinLimits:boolean}>;
