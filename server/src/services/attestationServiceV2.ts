/**
 * AttestationServiceV2 - Enhanced Attestation with Per-Leg Proofs
 *
 * Generates cryptographic proofs for each payment leg,
 * with Merkle chain linking and verification kit.
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { logger } from '../utils/logger';

const log = logger.child({ service: 'AttestationServiceV2' });

// ==================== Types ====================

export interface LegProof {
  legId: string;
  legIndex: number;
  tokenMint: string;
  tokenSymbol: string;
  amountIn: string;
  amountOut: string;
  dex: string;
  txSignature: string;
  slot: number;
  timestamp: number;
  priceAtExecution: number;
  slippageBps: number;
  hash: string;
  previousHash: string | null;
}

export interface PaymentAttestation {
  id: string;
  invoiceId: string;
  merchantId: string;
  payerPublicKey: string;
  totalAmountIn: string;
  totalAmountOut: string;
  legs: LegProof[];
  merkleRoot: string;
  aggregateSignature?: string;
  status: 'pending' | 'complete' | 'partial' | 'failed';
  createdAt: number;
  completedAt?: number;
}

export interface VerificationResult {
  valid: boolean;
  attestation?: PaymentAttestation;
  errors: string[];
  warnings: string[];
  chainIntegrity: boolean;
  allLegsVerified: boolean;
  onChainConfirmed: boolean;
}

export interface VerificationKit {
  attestationId: string;
  merkleRoot: string;
  legHashes: string[];
  merkleProofs: Map<string, string[]>;
  verificationUrl: string;
  qrCodeData: string;
}

// ==================== Service ====================

export class AttestationServiceV2 {
  private attestations: Map<string, PaymentAttestation> = new Map();
  private pendingLegs: Map<string, LegProof[]> = new Map();

  constructor(
    private readonly verificationBaseUrl: string = 'https://api.flowmint.io/verify'
  ) {}

  /**
   * Create attestation for a new payment
   */
  createAttestation(
    invoiceId: string,
    merchantId: string,
    payerPublicKey: string,
    expectedLegs: number
  ): PaymentAttestation {
    const attestation: PaymentAttestation = {
      id: uuidv4(),
      invoiceId,
      merchantId,
      payerPublicKey,
      totalAmountIn: '0',
      totalAmountOut: '0',
      legs: [],
      merkleRoot: '',
      status: 'pending',
      createdAt: Date.now(),
    };

    this.attestations.set(attestation.id, attestation);
    this.pendingLegs.set(attestation.id, []);

    log.info(
      { attestationId: attestation.id, invoiceId, expectedLegs },
      'Attestation created'
    );

    return attestation;
  }

  /**
   * Add leg proof to attestation
   */
  addLegProof(
    attestationId: string,
    legData: {
      legIndex: number;
      tokenMint: string;
      tokenSymbol: string;
      amountIn: string;
      amountOut: string;
      dex: string;
      txSignature: string;
      slot: number;
      priceAtExecution: number;
      slippageBps: number;
    }
  ): LegProof | null {
    const attestation = this.attestations.get(attestationId);
    if (!attestation) {
      log.warn({ attestationId }, 'Attestation not found');
      return null;
    }

    const pendingLegs = this.pendingLegs.get(attestationId) || [];

    // Get previous hash for chain
    const previousHash =
      pendingLegs.length > 0
        ? pendingLegs[pendingLegs.length - 1].hash
        : null;

    // Create leg proof
    const legProof: LegProof = {
      legId: uuidv4(),
      legIndex: legData.legIndex,
      tokenMint: legData.tokenMint,
      tokenSymbol: legData.tokenSymbol,
      amountIn: legData.amountIn,
      amountOut: legData.amountOut,
      dex: legData.dex,
      txSignature: legData.txSignature,
      slot: legData.slot,
      timestamp: Date.now(),
      priceAtExecution: legData.priceAtExecution,
      slippageBps: legData.slippageBps,
      hash: '', // Will be computed
      previousHash,
    };

    // Compute hash
    legProof.hash = this.computeLegHash(legProof);

    // Add to pending
    pendingLegs.push(legProof);
    this.pendingLegs.set(attestationId, pendingLegs);

    log.debug(
      {
        attestationId,
        legId: legProof.legId,
        tokenSymbol: legProof.tokenSymbol,
      },
      'Leg proof added'
    );

    return legProof;
  }

  /**
   * Finalize attestation with all legs
   */
  finalizeAttestation(attestationId: string): PaymentAttestation | null {
    const attestation = this.attestations.get(attestationId);
    const pendingLegs = this.pendingLegs.get(attestationId);

    if (!attestation || !pendingLegs) {
      log.warn({ attestationId }, 'Cannot finalize - not found');
      return null;
    }

    // Move pending legs to attestation
    attestation.legs = pendingLegs;

    // Calculate totals
    const totalIn = pendingLegs.reduce(
      (sum, leg) => sum + BigInt(leg.amountIn),
      0n
    );
    const totalOut = pendingLegs.reduce(
      (sum, leg) => sum + BigInt(leg.amountOut),
      0n
    );

    attestation.totalAmountIn = totalIn.toString();
    attestation.totalAmountOut = totalOut.toString();

    // Compute Merkle root
    attestation.merkleRoot = this.computeMerkleRoot(
      pendingLegs.map((l) => l.hash)
    );

    // Update status
    attestation.status = 'complete';
    attestation.completedAt = Date.now();

    // Cleanup pending
    this.pendingLegs.delete(attestationId);

    log.info(
      {
        attestationId,
        legCount: attestation.legs.length,
        merkleRoot: attestation.merkleRoot,
      },
      'Attestation finalized'
    );

    return attestation;
  }

  /**
   * Get attestation by ID
   */
  getAttestation(attestationId: string): PaymentAttestation | null {
    return this.attestations.get(attestationId) || null;
  }

  /**
   * Get attestation by invoice ID
   */
  getAttestationByInvoice(invoiceId: string): PaymentAttestation | null {
    for (const attestation of this.attestations.values()) {
      if (attestation.invoiceId === invoiceId) {
        return attestation;
      }
    }
    return null;
  }

  /**
   * Verify attestation integrity
   */
  verify(attestationId: string): VerificationResult {
    const attestation = this.attestations.get(attestationId);

    if (!attestation) {
      return {
        valid: false,
        errors: ['Attestation not found'],
        warnings: [],
        chainIntegrity: false,
        allLegsVerified: false,
        onChainConfirmed: false,
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    // Verify chain integrity
    const chainIntegrity = this.verifyChainIntegrity(attestation.legs);
    if (!chainIntegrity) {
      errors.push('Chain integrity verification failed');
    }

    // Verify Merkle root
    const computedRoot = this.computeMerkleRoot(
      attestation.legs.map((l) => l.hash)
    );
    if (computedRoot !== attestation.merkleRoot) {
      errors.push('Merkle root mismatch');
    }

    // Verify individual leg hashes
    let allLegsValid = true;
    for (const leg of attestation.legs) {
      const computedHash = this.computeLegHash(leg);
      if (computedHash !== leg.hash) {
        allLegsValid = false;
        errors.push(`Leg ${leg.legIndex} hash mismatch`);
      }
    }

    // Check for suspicious patterns
    if (attestation.legs.length > 5) {
      warnings.push('High number of legs detected');
    }

    // Calculate total slippage
    const totalSlippage = attestation.legs.reduce(
      (sum, leg) => sum + leg.slippageBps,
      0
    );
    if (totalSlippage > 200) {
      warnings.push(`High total slippage: ${totalSlippage} bps`);
    }

    // On-chain verification would be done async
    const onChainConfirmed = attestation.status === 'complete';

    return {
      valid: errors.length === 0,
      attestation,
      errors,
      warnings,
      chainIntegrity,
      allLegsVerified: allLegsValid,
      onChainConfirmed,
    };
  }

  /**
   * Generate verification kit for external verification
   */
  generateVerificationKit(attestationId: string): VerificationKit | null {
    const attestation = this.attestations.get(attestationId);
    if (!attestation) {
      return null;
    }

    const legHashes = attestation.legs.map((l) => l.hash);
    const merkleProofs = this.generateMerkleProofs(legHashes);

    const verificationUrl = `${this.verificationBaseUrl}/${attestationId}`;
    const qrCodeData = JSON.stringify({
      id: attestationId,
      merkleRoot: attestation.merkleRoot,
      url: verificationUrl,
    });

    return {
      attestationId,
      merkleRoot: attestation.merkleRoot,
      legHashes,
      merkleProofs,
      verificationUrl,
      qrCodeData,
    };
  }

  /**
   * Export attestation for long-term storage
   */
  exportAttestation(
    attestationId: string
  ): { json: string; hash: string } | null {
    const attestation = this.attestations.get(attestationId);
    if (!attestation) {
      return null;
    }

    const json = JSON.stringify(attestation, null, 2);
    const hash = createHash('sha256').update(json).digest('hex');

    return { json, hash };
  }

  /**
   * Import attestation from storage
   */
  importAttestation(json: string, expectedHash: string): boolean {
    try {
      const actualHash = createHash('sha256').update(json).digest('hex');
      if (actualHash !== expectedHash) {
        log.warn('Import hash mismatch');
        return false;
      }

      const attestation = JSON.parse(json) as PaymentAttestation;

      // Verify structure
      if (
        !attestation.id ||
        !attestation.invoiceId ||
        !attestation.merkleRoot
      ) {
        log.warn('Invalid attestation structure');
        return false;
      }

      this.attestations.set(attestation.id, attestation);
      log.info({ attestationId: attestation.id }, 'Attestation imported');
      return true;
    } catch (error) {
      log.error({ error }, 'Failed to import attestation');
      return false;
    }
  }

  // ==================== Private Helpers ====================

  private computeLegHash(leg: LegProof): string {
    const data = [
      leg.legIndex.toString(),
      leg.tokenMint,
      leg.amountIn,
      leg.amountOut,
      leg.dex,
      leg.txSignature,
      leg.slot.toString(),
      leg.previousHash || 'genesis',
    ].join(':');

    return createHash('sha256').update(data).digest('hex');
  }

  private computeMerkleRoot(hashes: string[]): string {
    if (hashes.length === 0) {
      return createHash('sha256').update('empty').digest('hex');
    }

    if (hashes.length === 1) {
      return hashes[0];
    }

    // Build Merkle tree
    let level = [...hashes];

    while (level.length > 1) {
      const nextLevel: string[] = [];

      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1] || left; // Duplicate if odd
        const combined = createHash('sha256')
          .update(left + right)
          .digest('hex');
        nextLevel.push(combined);
      }

      level = nextLevel;
    }

    return level[0];
  }

  private generateMerkleProofs(hashes: string[]): Map<string, string[]> {
    const proofs = new Map<string, string[]>();

    // For each hash, generate its proof path
    for (let i = 0; i < hashes.length; i++) {
      const proof: string[] = [];
      let level = [...hashes];
      let index = i;

      while (level.length > 1) {
        const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;

        if (siblingIndex < level.length) {
          proof.push(level[siblingIndex]);
        }

        // Move to next level
        const nextLevel: string[] = [];
        for (let j = 0; j < level.length; j += 2) {
          const left = level[j];
          const right = level[j + 1] || left;
          nextLevel.push(
            createHash('sha256').update(left + right).digest('hex')
          );
        }

        level = nextLevel;
        index = Math.floor(index / 2);
      }

      proofs.set(hashes[i], proof);
    }

    return proofs;
  }

  private verifyChainIntegrity(legs: LegProof[]): boolean {
    if (legs.length === 0) {
      return true;
    }

    // First leg should have null previous hash
    if (legs[0].previousHash !== null) {
      return false;
    }

    // Each subsequent leg should reference previous
    for (let i = 1; i < legs.length; i++) {
      if (legs[i].previousHash !== legs[i - 1].hash) {
        return false;
      }
    }

    return true;
  }

  /**
   * Cleanup old attestations
   */
  cleanup(maxAgeMs: number = 30 * 24 * 60 * 60_000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, attestation] of this.attestations) {
      if (now - attestation.createdAt > maxAgeMs) {
        this.attestations.delete(id);
        cleaned++;
      }
    }

    log.debug({ cleaned }, 'Old attestations cleaned');
    return cleaned;
  }
}

// ==================== Singleton ====================

let attestationServiceInstance: AttestationServiceV2 | null = null;

export function getAttestationServiceV2(
  verificationBaseUrl?: string
): AttestationServiceV2 {
  if (!attestationServiceInstance) {
    attestationServiceInstance = new AttestationServiceV2(verificationBaseUrl);
  }
  return attestationServiceInstance;
}

export default AttestationServiceV2;
