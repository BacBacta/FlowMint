/**
 * Initialize FlowMint program on devnet
 * 
 * This script initializes the protocol configuration account (PDA)
 * with default settings for devnet testing.
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// FlowMint Program ID (deployed on devnet)
const FLOWMINT_PROGRAM_ID = new PublicKey('CmPS9FdZQ4ex9A45yjvJGAjPBdBj6oYY9juQMfdzBJdi');

// Devnet RPC endpoint
const DEVNET_RPC = 'https://api.devnet.solana.com';

// Configuration parameters
const DEFAULT_SLIPPAGE_BPS = 300;    // 3% default slippage
const PROTECTED_SLIPPAGE_BPS = 100;  // 1% protected mode slippage
const MAX_PRICE_IMPACT_BPS = 500;    // 5% max price impact

/**
 * Derive the config PDA address
 */
function deriveConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    FLOWMINT_PROGRAM_ID
  );
}

/**
 * Create the initialize instruction data
 */
function createInitializeInstructionData(
  defaultSlippageBps: number,
  protectedSlippageBps: number,
  maxPriceImpactBps: number
): Buffer {
  // Anchor instruction discriminator for 'initialize'
  // This is the first 8 bytes of sha256("global:initialize")
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  
  // Encode the parameters (3 x u16 = 6 bytes)
  const params = Buffer.alloc(6);
  params.writeUInt16LE(defaultSlippageBps, 0);
  params.writeUInt16LE(protectedSlippageBps, 2);
  params.writeUInt16LE(maxPriceImpactBps, 4);
  
  return Buffer.concat([discriminator, params]);
}

async function main() {
  console.log('🚀 Initializing FlowMint on Devnet...\n');
  
  // Load keypair from default Solana config location
  const keypairPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  
  if (!fs.existsSync(keypairPath)) {
    console.error('❌ Keypair not found at', keypairPath);
    console.error('Please run: solana-keygen new');
    process.exit(1);
  }
  
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  console.log('📍 Authority:', authority.publicKey.toBase58());
  console.log('📍 Program ID:', FLOWMINT_PROGRAM_ID.toBase58());
  
  // Connect to devnet
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  
  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log('💰 Balance:', balance / 1e9, 'SOL\n');
  
  if (balance < 0.01 * 1e9) {
    console.error('❌ Insufficient balance. Need at least 0.01 SOL');
    process.exit(1);
  }
  
  // Derive config PDA
  const [configPDA, bump] = deriveConfigPDA();
  console.log('📍 Config PDA:', configPDA.toBase58());
  console.log('📍 Config Bump:', bump);
  
  // Check if already initialized
  const existingAccount = await connection.getAccountInfo(configPDA);
  if (existingAccount) {
    console.log('\n✅ Protocol already initialized!');
    console.log('   Account size:', existingAccount.data.length, 'bytes');
    console.log('   Owner:', existingAccount.owner.toBase58());
    return;
  }
  
  console.log('\n📝 Configuration:');
  console.log('   Default Slippage:', DEFAULT_SLIPPAGE_BPS / 100, '%');
  console.log('   Protected Slippage:', PROTECTED_SLIPPAGE_BPS / 100, '%');
  console.log('   Max Price Impact:', MAX_PRICE_IMPACT_BPS / 100, '%');
  
  // Treasury is the authority itself for testing
  const treasury = authority.publicKey;
  
  // Create instruction
  const instructionData = createInitializeInstructionData(
    DEFAULT_SLIPPAGE_BPS,
    PROTECTED_SLIPPAGE_BPS,
    MAX_PRICE_IMPACT_BPS
  );
  
  const instruction = {
    programId: FLOWMINT_PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  };
  
  // Create and send transaction
  const transaction = new Transaction().add(instruction);
  
  console.log('\n🔄 Sending transaction...');
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [authority],
      { commitment: 'confirmed' }
    );
    
    console.log('\n✅ Protocol initialized successfully!');
    console.log('📝 Signature:', signature);
    console.log('🔗 Explorer: https://solscan.io/tx/' + signature + '?cluster=devnet');
    
    // Verify the account was created
    const account = await connection.getAccountInfo(configPDA);
    if (account) {
      console.log('\n📊 Config Account Created:');
      console.log('   Size:', account.data.length, 'bytes');
      console.log('   Owner:', account.owner.toBase58());
    }
  } catch (error) {
    console.error('\n❌ Transaction failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
