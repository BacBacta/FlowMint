/**
 * Token Delegation Service
 *
 * Manages SPL Token delegations for non-custodial DCA execution.
 * Users approve a delegate to spend tokens on their behalf, without
 * transferring custody of their assets.
 *
 * Flow:
 * 1. User calls createDelegation() to get approval instruction
 * 2. User signs and submits the approval transaction
 * 3. User creates DCA intent with delegation reference
 * 4. During DCA execution, we verify delegation before swapping
 */

import { randomUUID } from 'crypto';

import { createApproveInstruction, getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';

import { config } from '../config/index.js';
import { DatabaseService } from '../db/database.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ service: 'TokenDelegation' });

/**
 * Delegation record stored in database
 */
export interface DelegationRecord {
  /** Unique delegation ID */
  id: string;
  /** User's wallet public key */
  userPublicKey: string;
  /** Token mint address */
  tokenMint: string;
  /** User's associated token account */
  tokenAccount: string;
  /** Delegate public key (FlowMint's authority) */
  delegatePublicKey: string;
  /** Approved amount (in smallest unit) */
  approvedAmount: string;
  /** Remaining delegated amount */
  remainingAmount: string;
  /** Status: pending, active, revoked, exhausted */
  status: 'pending' | 'active' | 'revoked' | 'exhausted';
  /** Associated intent ID (if any) */
  intentId?: string;
  /** Transaction signature of approval */
  approvalSignature?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Request to create a delegation
 */
export interface CreateDelegationRequest {
  /** User's wallet public key */
  userPublicKey: string;
  /** Token mint to delegate */
  tokenMint: string;
  /** Amount to approve for delegation */
  amount: string;
  /** Optional: Associate with an intent */
  intentId?: string;
}

/**
 * Response with unsigned transaction for delegation approval
 */
export interface DelegationApprovalResponse {
  /** Delegation ID for reference */
  delegationId: string;
  /** Serialized unsigned transaction (base64) */
  unsignedTransaction: string;
  /** Transaction message for signing */
  message: string;
  /** Expiry timestamp for this request */
  expiresAt: number;
}

/**
 * Token Delegation Service
 */
export class TokenDelegationService {
  private connection: Connection;

  /** FlowMint delegate authority - derived PDA or configured keypair */
  private delegateAuthority: PublicKey;

  constructor(private readonly db: DatabaseService) {
    this.connection = new Connection(config.solana.rpcUrl, 'confirmed');

    // Use configured delegate authority or derive from program
    // In production, this would be a PDA derived from the FlowMint program
    const delegateKey = process.env.FLOWMINT_DELEGATE_PUBKEY;
    if (delegateKey) {
      this.delegateAuthority = new PublicKey(delegateKey);
    } else {
      // For development, derive from a seed using System Program as placeholder
      // In production, replace with actual FlowMint program ID
      const programId = process.env.FLOWMINT_PROGRAM_ID || SystemProgram.programId.toBase58();
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('flowmint'), Buffer.from('delegate')],
        new PublicKey(programId)
      );
      this.delegateAuthority = pda;
    }

    log.info(
      { delegateAuthority: this.delegateAuthority.toBase58() },
      'TokenDelegationService initialized'
    );
  }

  /**
   * Get the delegate authority public key
   */
  getDelegateAuthority(): PublicKey {
    return this.delegateAuthority;
  }

  /**
   * Create a delegation approval request
   *
   * Returns an unsigned transaction that the user must sign to approve
   * the delegation. The user's tokens stay in their wallet.
   */
  async createDelegation(request: CreateDelegationRequest): Promise<DelegationApprovalResponse> {
    const { userPublicKey, tokenMint, amount, intentId } = request;

    const userPubkey = new PublicKey(userPublicKey);
    const mintPubkey = new PublicKey(tokenMint);

    // Get user's associated token account
    const userTokenAccount = await getAssociatedTokenAddress(mintPubkey, userPubkey);

    // Verify token account exists and has sufficient balance
    try {
      const accountInfo = await getAccount(this.connection, userTokenAccount);
      const balance = accountInfo.amount;

      if (BigInt(balance) < BigInt(amount)) {
        throw new Error(`Insufficient token balance. Have: ${balance}, Need: ${amount}`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'TokenAccountNotFoundError') {
        throw new Error('Token account not found. User must have the token before delegating.');
      }
      throw err;
    }

    // Create delegation record
    const delegationId = `del_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    const delegation: DelegationRecord = {
      id: delegationId,
      userPublicKey,
      tokenMint,
      tokenAccount: userTokenAccount.toBase58(),
      delegatePublicKey: this.delegateAuthority.toBase58(),
      approvedAmount: amount,
      remainingAmount: amount,
      status: 'pending',
      intentId,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.saveDelegation(delegation);

    // Create approve instruction
    const approveIx = createApproveInstruction(
      userTokenAccount, // Token account
      this.delegateAuthority, // Delegate
      userPubkey, // Owner
      BigInt(amount) // Amount
    );

    // Build transaction
    const transaction = new Transaction();
    transaction.add(approveIx);

    // Get recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;

    // Serialize transaction (unsigned)
    const serializedTx = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    // Expiry: 10 minutes
    const expiresAt = now + 10 * 60 * 1000;

    log.info(
      {
        delegationId,
        userPublicKey,
        tokenMint,
        amount,
        delegate: this.delegateAuthority.toBase58(),
      },
      'Delegation approval created'
    );

    return {
      delegationId,
      unsignedTransaction: serializedTx.toString('base64'),
      message: `Approve FlowMint to spend ${amount} tokens from your wallet for DCA execution. Your tokens remain in your wallet.`,
      expiresAt,
    };
  }

  /**
   * Confirm delegation after user signs and submits the approval transaction
   */
  async confirmDelegation(delegationId: string, signature: string): Promise<DelegationRecord> {
    const delegation = await this.db.getDelegation(delegationId);

    if (!delegation) {
      throw new Error('Delegation not found');
    }

    if (delegation.status !== 'pending') {
      throw new Error(`Delegation already ${delegation.status}`);
    }

    // Verify transaction on-chain
    const txInfo = await this.connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo || txInfo.meta?.err) {
      throw new Error('Transaction not found or failed');
    }

    // Verify the token account's delegate
    const tokenAccountPubkey = new PublicKey(delegation.tokenAccount);
    const accountInfo = await getAccount(this.connection, tokenAccountPubkey);

    if (!accountInfo.delegate || !accountInfo.delegate.equals(this.delegateAuthority)) {
      throw new Error('Delegation not found on token account');
    }

    // Verify delegated amount
    if (accountInfo.delegatedAmount < BigInt(delegation.approvedAmount)) {
      throw new Error('Delegated amount is less than requested');
    }

    // Update delegation status
    const updated: DelegationRecord = {
      ...delegation,
      status: 'active',
      approvalSignature: signature,
      updatedAt: Date.now(),
    };

    await this.db.updateDelegation(updated);

    log.info({ delegationId, signature }, 'Delegation confirmed');

    return updated;
  }

  /**
   * Check if there's sufficient delegation for an amount
   */
  async verifyDelegation(
    userPublicKey: string,
    tokenMint: string,
    requiredAmount: string
  ): Promise<{ valid: boolean; delegation?: DelegationRecord; message?: string }> {
    // Get active delegation for this user and token
    const delegations = await this.db.getDelegationsByUser(userPublicKey);
    const activeDelegation = delegations.find(
      d => d.tokenMint === tokenMint && d.status === 'active'
    );

    if (!activeDelegation) {
      return { valid: false, message: 'No active delegation found for this token' };
    }

    // Verify on-chain delegation is still valid
    try {
      const tokenAccountPubkey = new PublicKey(activeDelegation.tokenAccount);
      const accountInfo = await getAccount(this.connection, tokenAccountPubkey);

      if (!accountInfo.delegate || !accountInfo.delegate.equals(this.delegateAuthority)) {
        // Delegation was revoked on-chain
        await this.db.updateDelegation({
          ...activeDelegation,
          status: 'revoked',
          updatedAt: Date.now(),
        });
        return { valid: false, message: 'Delegation was revoked on-chain' };
      }

      // Check on-chain delegated amount
      const onChainDelegated = accountInfo.delegatedAmount;
      if (onChainDelegated < BigInt(requiredAmount)) {
        return {
          valid: false,
          message: `Insufficient delegation. On-chain: ${onChainDelegated}, Required: ${requiredAmount}`,
        };
      }

      return { valid: true, delegation: activeDelegation };
    } catch (err: unknown) {
      log.error({ err, delegationId: activeDelegation.id }, 'Failed to verify delegation on-chain');
      return { valid: false, message: 'Failed to verify delegation on-chain' };
    }
  }

  /**
   * Record a delegation usage (after swap execution)
   */
  async recordUsage(delegationId: string, amountUsed: string): Promise<void> {
    const delegation = await this.db.getDelegation(delegationId);
    if (!delegation) {
      throw new Error('Delegation not found');
    }

    const remaining = BigInt(delegation.remainingAmount) - BigInt(amountUsed);

    const updated: DelegationRecord = {
      ...delegation,
      remainingAmount: remaining.toString(),
      status: remaining <= 0n ? 'exhausted' : 'active',
      updatedAt: Date.now(),
    };

    await this.db.updateDelegation(updated);

    log.info(
      { delegationId, amountUsed, remaining: remaining.toString() },
      'Delegation usage recorded'
    );
  }

  /**
   * Revoke a delegation (creates revoke instruction for user to sign)
   */
  async createRevocation(delegationId: string): Promise<{ unsignedTransaction: string }> {
    const delegation = await this.db.getDelegation(delegationId);
    if (!delegation) {
      throw new Error('Delegation not found');
    }

    if (delegation.status !== 'active') {
      throw new Error('Delegation is not active');
    }

    const userPubkey = new PublicKey(delegation.userPublicKey);
    const tokenAccountPubkey = new PublicKey(delegation.tokenAccount);

    // Create revoke instruction (sets delegate to null)
    const revokeIx = createApproveInstruction(
      tokenAccountPubkey,
      this.delegateAuthority,
      userPubkey,
      0n // Setting to 0 effectively revokes
    );

    const transaction = new Transaction();
    transaction.add(revokeIx);

    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;

    const serializedTx = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return { unsignedTransaction: serializedTx.toString('base64') };
  }

  /**
   * Confirm revocation after user signs
   */
  async confirmRevocation(delegationId: string, signature: string): Promise<void> {
    const delegation = await this.db.getDelegation(delegationId);
    if (!delegation) {
      throw new Error('Delegation not found');
    }

    await this.db.updateDelegation({
      ...delegation,
      status: 'revoked',
      updatedAt: Date.now(),
    });

    log.info({ delegationId, signature }, 'Delegation revoked');
  }

  /**
   * Get user's delegations
   */
  async getUserDelegations(userPublicKey: string): Promise<DelegationRecord[]> {
    return this.db.getDelegationsByUser(userPublicKey);
  }

  /**
   * Get delegation by ID
   */
  async getDelegation(delegationId: string): Promise<DelegationRecord | undefined> {
    return this.db.getDelegation(delegationId);
  }
}

// Singleton instance
let delegationService: TokenDelegationService | null = null;

export function getTokenDelegationService(db: DatabaseService): TokenDelegationService {
  if (!delegationService) {
    delegationService = new TokenDelegationService(db);
  }
  return delegationService;
}

export function resetTokenDelegationService(): void {
  delegationService = null;
}
