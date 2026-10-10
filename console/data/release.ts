/** Decimal strings preserve Solidity uint256 values without JS rounding. */
export type Uint256Decimal = string;
export type UUID = string;
export type ReleaseState = "draft" | "validated" | "published" | "deployed" | "policy-configured" | "minting" | "minting-closed" | "archived";
export type JobState = "queued" | "awaiting-signature" | "submitted" | "confirmed" | "failed" | "reconciled";
export type ListingState = "submitted" | "active" | "sold" | "expired" | "cancelled" | "unknown";

/** Routing metadata only; no title, filename, draft legal text or decryption key. */
export interface EncryptedReleaseRecord {
  id: UUID;
  ownerAccountId: UUID;
  workspaceCiphertext: Uint8Array;
  workspaceNonce: Uint8Array;
  revision: string;
  state: ReleaseState;
}

/** Intentionally public after a separate, explicit publishing confirmation. */
export interface PublicationRecord {
  id: UUID;
  releaseId: UUID;
  tokenId: Uint256Decimal;
  title: string;
  mediaSHA256: Uint8Array;
  rightsSHA256: Uint8Array;
  metadataSHA256: Uint8Array;
  mediaURI: string;
  rightsURI: string;
  metadataURI: string;
  consentDigest: Uint8Array;
}
