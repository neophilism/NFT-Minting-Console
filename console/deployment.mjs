import { Contract, ZeroAddress, ZeroHash, getAddress, id, isAddress, isHexString } from "ethers";

export const FACTORY_VERSION = id("nft-console.collection-factory.v2");

/** Reconcile the public, requester-scoped slot; this is not RPC/bytecode attestation. */
export async function reconcileDeployment(provider, { chainId, factory, releaseId, requester }) {
  if (!isHexString(releaseId, 32) || releaseId === ZeroHash) throw new Error("Invalid release ID");
  if (!isAddress(requester) || requester === ZeroAddress) throw new Error("Requester address required");
  if (!isAddress(factory) || factory === ZeroAddress) throw new Error("Deployment factory address required");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid target chain");
  if ((await provider.getNetwork()).chainId !== BigInt(chainId)) throw new Error("RPC chain does not match configured chain");
  factory = getAddress(factory);
  requester = getAddress(requester);
  if (await provider.getCode(factory) === "0x") throw new Error("Deployment factory has no bytecode");
  const contract = new Contract(factory, [
    "function FACTORY_VERSION() view returns(bytes32)",
    "function collectionForRelease(address,bytes32) view returns(address)",
  ], provider);
  if (await contract.FACTORY_VERSION() !== FACTORY_VERSION) throw new Error("Incompatible deployment factory version");
  const collection = await contract.collectionForRelease(requester, releaseId);
  const deployed = collection !== ZeroAddress && await provider.getCode(collection) !== "0x";
  return { releaseId, requester, factory, collection, deployed, chainId, factoryVersion: FACTORY_VERSION };
}
