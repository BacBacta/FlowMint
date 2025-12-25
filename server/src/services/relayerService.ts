/**
 * RelayerService - PortfolioPay V1
 *
 * Handles gasless transaction submission for users with 0 SOL.
 * Validates, co-signs, and broadcasts transactions on behalf of users.
 */

import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
  TransactionSignature,
  SendTransactionError,
  PublicKey,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';

import { DatabaseService, RelayerSubmissionRecord } from '../db/database';

// Constants
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const CONFIRMATION_TIMEOUT_MS = 60000;
const DEFAULT_RELAYER_FEE_LAMPORTS = 5000; // 0.000005 SOL

// Allowlist of mints that can be used for gasless payments
const GASLESS_ALLOWLIST = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'So11111111111111111111111111111111111111112', // wSOL
];

export interface GaslessEligibilityResult {
  eligible: boolean;
  reason?: string;
  payMint?: string;
  userSolBalance?: number;
}

export interface ValidateTransactionResult {
  valid: boolean;
  errors: string[];
  transaction?: VersionedTransaction;
  hash?: string;
}

export interface SubmitGaslessParams {
  invoiceId: string;
  payer: string;
  signedTransaction: string; // Base64 encoded user-signed transaction
  relayerKeypair: Keypair;
}

export interface SubmitResult {
  success: boolean;
  submissionId: string;
  signature?: string;
  error?: string;
}

export interface ConfirmResult {
  confirmed: boolean;
  slot?: number;
  error?: string;
}

export class RelayerService {
  private relayerKeypair?: Keypair;
  private relayerFeeLamports: number;

  constructor(
    private connection: Connection,
    private db: DatabaseService,
    relayerKeypair?: Keypair,
    relayerFeeLamports?: number
  ) {
    this.relayerKeypair = relayerKeypair;
    this.relayerFeeLamports = relayerFeeLamports || DEFAULT_RELAYER_FEE_LAMPORTS;
  }

  /**
   * Check if a user is eligible for gasless payment
   */
  async checkGaslessEligibility(
    userPublicKey: string,
    payMint: string
  ): Promise<GaslessEligibilityResult> {
    try {
      const pubkey = new PublicKey(userPublicKey);
      const balance = await this.connection.getBalance(pubkey);

      // User has enough SOL for gas
      if (balance > 10000) {
        // > 0.00001 SOL
        return {
          eligible: false,
          reason: 'User has sufficient SOL balance',
          payMint,
          userSolBalance: balance,
        };
      }

      // Check if pay mint is in allowlist
      if (!GASLESS_ALLOWLIST.includes(payMint)) {
        return {
          eligible: false,
          reason: `Token ${payMint} not eligible for gasless payments`,
          payMint,
          userSolBalance: balance,
        };
      }

      return {
        eligible: true,
        payMint,
        userSolBalance: balance,
      };
    } catch (error) {
      return {
        eligible: false,
        reason: `Error checking eligibility: ${error instanceof Error ? error.message : 'Unknown'}`,
        payMint,
      };
    }
  }

  /**
   * Get list of tokens eligible for gasless payments
   */
  getGaslessAllowlist(): string[] {
    return [...GASLESS_ALLOWLIST];
  }

  /**
   * Validate a user-signed transaction before relaying
   */
  async validateTransaction(
    signedTransactionBase64: string,
    expectedPayer: string,
    invoiceId: string
  ): Promise<ValidateTransactionResult> {
    const errors: string[] = [];

    try {
      // Decode transaction
      const txBuffer = Buffer.from(signedTransactionBase64, 'base64');
      let transaction: VersionedTransaction;

      try {
        transaction = VersionedTransaction.deserialize(txBuffer);
      } catch {
        return {
          valid: false,
          errors: ['Invalid transaction format'],
        };
      }

      // Hash for tracking
      const hash = bs58.encode(transaction.message.serialize().slice(0, 32));

      // Verify transaction has signatures
      if (transaction.signatures.length === 0) {
        errors.push('Transaction has no signatures');
      }

      // Check that payer signed
      const payerPubkey = new PublicKey(expectedPayer);
      const messageAccountKeys = transaction.message.staticAccountKeys;

      if (messageAccountKeys.length === 0) {
        errors.push('Transaction has no account keys');
      }

      // The fee payer should be the first account
      const feePayer = messageAccountKeys[0];
      if (!feePayer.equals(payerPubkey)) {
        // For gasless, the relayer might be fee payer
        // But user should still be a signer
        const payerIndex = messageAccountKeys.findIndex(k => k.equals(payerPubkey));
        if (payerIndex === -1) {
          errors.push('Payer not found in transaction accounts');
        }
      }

      // Verify transaction is not too old
      // (Would check blockhash validity in production)

      // Basic sanity checks passed
      return {
        valid: errors.length === 0,
        errors,
        transaction,
        hash,
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Validation error: ${error instanceof Error ? error.message : 'Unknown'}`],
      };
    }
  }

  /**
   * Submit a gasless transaction (co-sign and broadcast)
   */
  async submitGasless(params: SubmitGaslessParams): Promise<SubmitResult> {
    const submissionId = uuidv4();
    const now = Date.now();

    // Record submission attempt
    const submission: RelayerSubmissionRecord = {
      id: submissionId,
      invoiceId: params.invoiceId,
      payer: params.payer,
      signedTxHash: '',
      relayerFeeLamports: this.relayerFeeLamports,
      status: 'pending',
      submittedAt: now,
      createdAt: now,
    };

    try {
      // Validate transaction
      const validation = await this.validateTransaction(
        params.signedTransaction,
        params.payer,
        params.invoiceId
      );

      if (!validation.valid || !validation.transaction) {
        submission.status = 'failed';
        submission.error = validation.errors.join('; ');
        await this.db.saveRelayerSubmission(submission);

        return {
          success: false,
          submissionId,
          error: submission.error,
        };
      }

      submission.signedTxHash = validation.hash || '';
      await this.db.saveRelayerSubmission(submission);

      // Co-sign with relayer if needed
      const transaction = validation.transaction;

      if (this.relayerKeypair) {
        // Check if relayer needs to sign (as fee payer)
        const messageAccountKeys = transaction.message.staticAccountKeys;
        const relayerIndex = messageAccountKeys.findIndex(k =>
          k.equals(this.relayerKeypair!.publicKey)
        );

        if (relayerIndex !== -1 && transaction.signatures.length > relayerIndex) {
          // Relayer is in the transaction, add signature
          transaction.sign([this.relayerKeypair]);
        }
      }

      // Serialize and send
      const serialized = transaction.serialize();
      let signature: TransactionSignature | undefined;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          signature = await this.connection.sendRawTransaction(serialized, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 3,
          });

          // Update submission with signature
          await this.db.updateRelayerSubmission(submissionId, {
            status: 'submitted',
            signature,
          });

          return {
            success: true,
            submissionId,
            signature,
          };
        } catch (error) {
          if (attempt === MAX_RETRIES - 1) {
            const errorMessage =
              error instanceof SendTransactionError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : 'Unknown error';

            await this.db.updateRelayerSubmission(submissionId, {
              status: 'failed',
              error: errorMessage,
            });

            return {
              success: false,
              submissionId,
              error: errorMessage,
            };
          }

          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        }
      }

      return {
        success: false,
        submissionId,
        error: 'Max retries exceeded',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.db.updateRelayerSubmission(submissionId, {
        status: 'failed',
        error: errorMessage,
      });

      return {
        success: false,
        submissionId,
        error: errorMessage,
      };
    }
  }

  /**
   * Confirm a submitted transaction
   */
  async confirmTransaction(signature: string): Promise<ConfirmResult> {
    try {
      const result = await this.connection.confirmTransaction(signature, 'confirmed');

      if (result.value.err) {
        return {
          confirmed: false,
          error: JSON.stringify(result.value.err),
        };
      }

      // Get slot from transaction
      const txInfo = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      return {
        confirmed: true,
        slot: txInfo?.slot,
      };
    } catch (error) {
      return {
        confirmed: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Poll for transaction confirmation with timeout
   */
  async waitForConfirmation(
    signature: string,
    timeoutMs: number = CONFIRMATION_TIMEOUT_MS
  ): Promise<ConfirmResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.confirmTransaction(signature);

      if (result.confirmed || result.error) {
        return result;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return {
      confirmed: false,
      error: 'Confirmation timeout',
    };
  }

  /**
   * Get submission status
   */
  async getSubmission(submissionId: string): Promise<RelayerSubmissionRecord | undefined> {
    return this.db.getRelayerSubmission(submissionId);
  }

  /**
   * Update submission after confirmation
   */
  async markConfirmed(submissionId: string, slot?: number): Promise<void> {
    await this.db.updateRelayerSubmission(submissionId, {
      status: 'confirmed',
      confirmedAt: Date.now(),
    });
  }

  /**
   * Build fee estimate for gasless transaction
   */
  async estimateRelayerFee(): Promise<{
    feeLamports: number;
    feeUsd: number;
  }> {
    // In production, would fetch SOL price
    const solPriceUsd = 150; // Placeholder
    const feeUsd = (this.relayerFeeLamports / 1e9) * solPriceUsd;

    return {
      feeLamports: this.relayerFeeLamports,
      feeUsd,
    };
  }

  /**
   * Set relayer keypair (for hot wallet management)
   */
  setRelayerKeypair(keypair: Keypair): void {
    this.relayerKeypair = keypair;
  }

  /**
   * Get relayer public key
   */
  getRelayerPublicKey(): string | undefined {
    return this.relayerKeypair?.publicKey.toBase58();
  }
}

export const createRelayerService = (
  connection: Connection,
  db: DatabaseService,
  relayerKeypair?: Keypair,
  relayerFeeLamports?: number
): RelayerService => {
  return new RelayerService(connection, db, relayerKeypair, relayerFeeLamports);
};
