/**
 * AttestationService - PortfolioPay V1
 *
 * Creates cryptographic attestations for policy-compliant payments.
 * Signs planned vs actual execution data with Ed25519.
 */

import * as crypto from 'crypto';

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { v4 as uuidv4 } from 'uuid';

import { DatabaseService, AttestationRecord, PolicyRecord, InvoiceRecord } from '../db/database';

// Attestation payload structure
export interface AttestationPayload {
  version: '1.0';
  invoiceId: string;
  policyHash: string;
  timestamp: number;
  planned: PlannedExecution;
  actual: ActualExecution;
}

export interface PlannedExecution {
  payMint: string;
  settleMint: string;
  amountIn: string;
  amountOut: string;
  route: RouteHop[];
  priceImpactBps: number;
  slippageBps: number;
  gasless: boolean;
}

export interface RouteHop {
  dex: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
}

export interface ActualExecution {
  signature: string;
  slot: number;
  amountInActual: string;
  amountOutActual: string;
  feesPaid: string;
  success: boolean;
  timestamp: number;
}

export interface RiskAssessment {
  priceImpactBps: number;
  slippageBps: number;
  hops: number;
  routeComplexity: 'simple' | 'medium' | 'complex';
  warnings: string[];
}

export interface PolicyViolation {
  field: string;
  limit: number | string;
  actual: number | string;
  message: string;
}

export interface CreateAttestationParams {
  invoiceId: string;
  policy: PolicyRecord;
  planned: PlannedExecution;
  actual: ActualExecution;
  signerKeypair: Keypair;
}

export interface VerifyAttestationResult {
  valid: boolean;
  errors: string[];
  attestation?: AttestationRecord;
}

export class AttestationService {
  private baseUrl: string;

  constructor(
    private db: DatabaseService,
    baseUrl?: string
  ) {
    this.baseUrl = baseUrl || process.env.BASE_URL || 'https://flowmint-server.fly.dev';
  }

  /**
   * Hash a policy to create a deterministic identifier
   */
  hashPolicy(policy: PolicyRecord): string {
    const canonical = JSON.stringify({
      merchantId: policy.merchantId,
      maxSlippageBps: policy.maxSlippageBps,
      maxPriceImpactBps: policy.maxPriceImpactBps,
      maxHops: policy.maxHops,
      protectedMode: policy.protectedMode,
      allowedTokens: policy.allowedTokens?.sort() || [],
      deniedTokens: policy.deniedTokens?.sort() || [],
    });

    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Validate execution plan against policy
   */
  validateAgainstPolicy(
    planned: PlannedExecution,
    policy: PolicyRecord
  ): { valid: boolean; violations: PolicyViolation[] } {
    const violations: PolicyViolation[] = [];

    // Check slippage
    if (planned.slippageBps > policy.maxSlippageBps) {
      violations.push({
        field: 'slippageBps',
        limit: policy.maxSlippageBps,
        actual: planned.slippageBps,
        message: `Slippage ${planned.slippageBps} bps exceeds max ${policy.maxSlippageBps} bps`,
      });
    }

    // Check price impact
    if (planned.priceImpactBps > policy.maxPriceImpactBps) {
      violations.push({
        field: 'priceImpactBps',
        limit: policy.maxPriceImpactBps,
        actual: planned.priceImpactBps,
        message: `Price impact ${planned.priceImpactBps} bps exceeds max ${policy.maxPriceImpactBps} bps`,
      });
    }

    // Check max hops
    if (planned.route.length > policy.maxHops) {
      violations.push({
        field: 'hops',
        limit: policy.maxHops,
        actual: planned.route.length,
        message: `Route has ${planned.route.length} hops, max is ${policy.maxHops}`,
      });
    }

    // Check allowed tokens
    if (policy.allowedTokens && policy.allowedTokens.length > 0) {
      if (!policy.allowedTokens.includes(planned.payMint)) {
        violations.push({
          field: 'payMint',
          limit: policy.allowedTokens.join(', '),
          actual: planned.payMint,
          message: `Token ${planned.payMint} not in allowed list`,
        });
      }
    }

    // Check denied tokens
    if (policy.deniedTokens && policy.deniedTokens.includes(planned.payMint)) {
      violations.push({
        field: 'payMint',
        limit: 'not in denied list',
        actual: planned.payMint,
        message: `Token ${planned.payMint} is in denied list`,
      });
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Assess risk of a planned execution
   */
  assessRisk(planned: PlannedExecution): RiskAssessment {
    const warnings: string[] = [];

    // Determine route complexity
    let routeComplexity: 'simple' | 'medium' | 'complex' = 'simple';
    if (planned.route.length >= 4) {
      routeComplexity = 'complex';
      warnings.push('Complex route with 4+ hops increases MEV risk');
    } else if (planned.route.length >= 2) {
      routeComplexity = 'medium';
    }

    // Check price impact
    if (planned.priceImpactBps > 200) {
      warnings.push(`High price impact: ${planned.priceImpactBps / 100}%`);
    }

    // Check slippage
    if (planned.slippageBps > 100) {
      warnings.push(`High slippage tolerance: ${planned.slippageBps / 100}%`);
    }

    // Check gasless implications
    if (planned.gasless) {
      warnings.push('Gasless mode: relayer will broadcast transaction');
    }

    return {
      priceImpactBps: planned.priceImpactBps,
      slippageBps: planned.slippageBps,
      hops: planned.route.length,
      routeComplexity,
      warnings,
    };
  }

  /**
   * Create and sign an attestation
   */
  async createAttestation(params: CreateAttestationParams): Promise<AttestationRecord> {
    const { invoiceId, policy, planned, actual, signerKeypair } = params;

    // Validate against policy first
    const validation = this.validateAgainstPolicy(planned, policy);
    if (!validation.valid) {
      throw new Error(`Policy violation: ${validation.violations.map(v => v.message).join('; ')}`);
    }

    // Build attestation payload
    const policyHash = this.hashPolicy(policy);
    const payload: AttestationPayload = {
      version: '1.0',
      invoiceId,
      policyHash,
      timestamp: Date.now(),
      planned,
      actual,
    };

    // Sign the payload
    const payloadJson = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(payloadJson);
    const signature = nacl.sign.detached(payloadBytes, signerKeypair.secretKey);
    const signatureBase58 = bs58.encode(signature);

    // Create attestation ID
    const attestationId = uuidv4();

    // Build verification URL
    const verificationUrl = `${this.baseUrl}/api/v1/attestations/${attestationId}/verify`;

    const attestation: AttestationRecord = {
      id: attestationId,
      invoiceId,
      policyHash,
      payloadJson,
      plannedJson: JSON.stringify(planned),
      actualJson: JSON.stringify(actual),
      signerPubkey: signerKeypair.publicKey.toBase58(),
      signature: signatureBase58,
      verificationUrl,
      createdAt: Date.now(),
    };

    await this.db.saveAttestation(attestation);

    return attestation;
  }

  /**
   * Verify an attestation signature
   */
  async verifyAttestation(attestationId: string): Promise<VerifyAttestationResult> {
    const errors: string[] = [];

    const attestation = await this.db.getAttestation(attestationId);
    if (!attestation) {
      return { valid: false, errors: ['Attestation not found'] };
    }

    try {
      // Decode signature and public key
      const signature = bs58.decode(attestation.signature);
      const publicKey = bs58.decode(attestation.signerPubkey);

      // Verify signature
      const payloadBytes = new TextEncoder().encode(attestation.payloadJson);
      const isValid = nacl.sign.detached.verify(payloadBytes, signature, publicKey);

      if (!isValid) {
        errors.push('Invalid signature');
      }

      // Parse and validate payload structure
      const payload: AttestationPayload = JSON.parse(attestation.payloadJson);

      if (payload.version !== '1.0') {
        errors.push(`Unsupported attestation version: ${payload.version}`);
      }

      if (payload.invoiceId !== attestation.invoiceId) {
        errors.push('Invoice ID mismatch');
      }

      if (payload.policyHash !== attestation.policyHash) {
        errors.push('Policy hash mismatch');
      }

      // Verify invoice exists and matches
      const invoice = await this.db.getInvoice(attestation.invoiceId);
      if (!invoice) {
        errors.push('Referenced invoice not found');
      } else if (invoice.status !== 'paid') {
        errors.push(`Invoice status is ${invoice.status}, expected paid`);
      }

      return {
        valid: errors.length === 0,
        errors,
        attestation,
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Verification error: ${error instanceof Error ? error.message : 'Unknown'}`],
        attestation,
      };
    }
  }

  /**
   * Get attestation by invoice ID
   */
  async getAttestationByInvoice(invoiceId: string): Promise<AttestationRecord | undefined> {
    return this.db.getAttestationByInvoice(invoiceId);
  }

  /**
   * Get attestation by ID
   */
  async getAttestation(attestationId: string): Promise<AttestationRecord | undefined> {
    return this.db.getAttestation(attestationId);
  }

  /**
   * Build attestation summary for API response
   */
  buildAttestationSummary(attestation: AttestationRecord): {
    id: string;
    invoiceId: string;
    policyHash: string;
    signerPubkey: string;
    signature: string;
    verificationUrl: string;
    createdAt: number;
  } {
    return {
      id: attestation.id,
      invoiceId: attestation.invoiceId,
      policyHash: attestation.policyHash,
      signerPubkey: attestation.signerPubkey,
      signature: attestation.signature,
      verificationUrl: attestation.verificationUrl || '',
      createdAt: attestation.createdAt,
    };
  }
}

export const createAttestationService = (
  db: DatabaseService,
  baseUrl?: string
): AttestationService => {
  return new AttestationService(db, baseUrl);
};
