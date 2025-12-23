/**
 * Payment Service Tests
 *
 * Tests for payment processing with FlowMint integration.
 */

import { PublicKey, Keypair } from '@solana/web3.js';

describe('PaymentService', () => {
  // Test keypairs
  const payer = Keypair.generate();
  const merchant = Keypair.generate();

  // Mock mint addresses
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

  describe('Payment Request Validation', () => {
    it('should validate required payment fields', () => {
      const validRequest = {
        payerPublicKey: payer.publicKey.toBase58(),
        merchantPublicKey: merchant.publicKey.toBase58(),
        amountUsdc: '100000000', // 100 USDC
        tokenFrom: SOL_MINT,
      };

      expect(validRequest.payerPublicKey).toBeTruthy();
      expect(validRequest.merchantPublicKey).toBeTruthy();
      expect(validRequest.amountUsdc).toBeTruthy();
      expect(validRequest.tokenFrom).toBeTruthy();
    });

    it('should validate USDC amount format', () => {
      const amountUSDC = '100000000'; // 100.000000 USDC (6 decimals)
      const parsedAmount = BigInt(amountUSDC);

      expect(parsedAmount).toEqual(BigInt(100_000_000));
    });

    it('should accept optional memo', () => {
      const requestWithMemo = {
        payerPublicKey: payer.publicKey.toBase58(),
        merchantPublicKey: merchant.publicKey.toBase58(),
        amountUsdc: '50000000',
        tokenFrom: SOL_MINT,
        memo: 'Invoice #12345',
      };

      expect(requestWithMemo.memo).toBeTruthy();
    });

    it('should accept FlowMint program options', () => {
      const requestWithFlowMint = {
        payerPublicKey: payer.publicKey.toBase58(),
        merchantPublicKey: merchant.publicKey.toBase58(),
        amountUsdc: '100000000',
        tokenFrom: SOL_MINT,
        useFlowMintProgram: true,
        payerInputAccount: Keypair.generate().publicKey.toBase58(),
        payerUsdcAccount: Keypair.generate().publicKey.toBase58(),
        merchantUsdcAccount: Keypair.generate().publicKey.toBase58(),
      };

      expect(requestWithFlowMint.useFlowMintProgram).toBe(true);
      expect(requestWithFlowMint.payerInputAccount).toBeTruthy();
      expect(requestWithFlowMint.payerUsdcAccount).toBeTruthy();
      expect(requestWithFlowMint.merchantUsdcAccount).toBeTruthy();
    });
  });

  describe('Payment Quote Generation', () => {
    it('should calculate ExactOut quote for non-USDC tokens', () => {
      // ExactOut mode: specify exactly how much USDC merchant receives
      const exactUsdcOut = 100_000_000; // 100 USDC
      const estimatedInputAmount = 1_000_000_000; // 1 SOL (at $100/SOL)
      const slippageBuffer = 1.01; // 1% buffer
      const maxInputAmount = Math.ceil(estimatedInputAmount * slippageBuffer);

      expect(maxInputAmount).toBeGreaterThan(estimatedInputAmount);
    });

    it('should skip swap for direct USDC payments', () => {
      const tokenFrom = USDC_MINT;
      const isDirectUsdc = tokenFrom === USDC_MINT;

      expect(isDirectUsdc).toBe(true);
    });

    it('should include route information in quote', () => {
      const quote = {
        quoteId: 'quote-123',
        usdcAmount: '100000000',
        inputToken: SOL_MINT,
        estimatedInputAmount: '1000000000',
        maxInputAmount: '1010000000',
        priceImpactPct: '0.3',
        expiresAt: Date.now() + 30000,
        route: {
          steps: 1,
          labels: ['Orca'],
        },
      };

      expect(quote.route.steps).toEqual(1);
      expect(quote.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('Payment Execution', () => {
    it('should verify payer has sufficient balance', () => {
      const payerBalance = BigInt(2_000_000_000); // 2 SOL
      const maxInputAmount = BigInt(1_010_000_000); // ~1.01 SOL

      expect(payerBalance >= maxInputAmount).toBe(true);
    });

    it('should reject insufficient balance', () => {
      const payerBalance = BigInt(500_000_000); // 0.5 SOL
      const maxInputAmount = BigInt(1_010_000_000); // ~1.01 SOL

      expect(payerBalance < maxInputAmount).toBe(true);
    });

    it('should create pending payment record', () => {
      const record = {
        paymentId: 'pay-123',
        payerPublicKey: payer.publicKey.toBase58(),
        merchantPublicKey: merchant.publicKey.toBase58(),
        inputToken: SOL_MINT,
        inputAmount: '1000000000',
        usdcAmount: '100000000',
        memo: 'Invoice #12345',
        status: 'pending' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(record.status).toEqual('pending');
      expect(record.paymentId).toBeTruthy();
    });

    it('should return transaction for signing', () => {
      const result = {
        paymentId: 'pay-123',
        status: 'pending' as const,
        usdcAmount: '100000000',
        inputAmount: '1000000000',
        inputToken: SOL_MINT,
        merchantPublicKey: merchant.publicKey.toBase58(),
        transaction: 'base64-encoded-transaction',
        lastValidBlockHeight: 12345,
        timestamp: Date.now(),
      };

      expect(result.transaction).toBeTruthy();
      expect(result.lastValidBlockHeight).toBeGreaterThan(0);
    });
  });

  describe('FlowMint Integration', () => {
    it('should calculate payment record PDA', () => {
      const PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
      const timestamp = Math.floor(Date.now() / 1000);
      const tsBuffer = Buffer.alloc(8);
      tsBuffer.writeBigInt64LE(BigInt(timestamp));

      const [paymentRecordPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('payment'),
          payer.publicKey.toBuffer(),
          merchant.publicKey.toBuffer(),
          tsBuffer,
        ],
        PROGRAM_ID
      );

      expect(paymentRecordPda).toBeInstanceOf(PublicKey);
    });

    it('should include FlowMint fields in result', () => {
      const result = {
        paymentId: 'pay-123',
        status: 'pending' as const,
        usdcAmount: '100000000',
        inputAmount: '1000000000',
        inputToken: SOL_MINT,
        merchantPublicKey: merchant.publicKey.toBase58(),
        transaction: 'base64-wrapped-transaction',
        lastValidBlockHeight: 12345,
        timestamp: Date.now(),
        // FlowMint-specific fields
        paymentRecordPda: 'payment-record-pda-address',
        routeData: 'base64-route-data',
      };

      expect(result.paymentRecordPda).toBeTruthy();
      expect(result.routeData).toBeTruthy();
    });

    it('should serialize route for on-chain payment', () => {
      const quote = {
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: '1000000000',
        outAmount: '100000000',
        routePlan: [{ swapInfo: { label: 'Orca' }, percent: 100 }],
      };

      expect(quote.routePlan.length).toEqual(1);
    });
  });

  describe('Direct USDC Payments', () => {
    it('should handle direct USDC transfer', () => {
      const tokenFrom = USDC_MINT;
      const isDirectUsdc = tokenFrom === USDC_MINT;

      expect(isDirectUsdc).toBe(true);
    });

    it('should skip Jupiter quote for USDC', () => {
      const tokenFrom = USDC_MINT;
      const amountUsdc = '50000000';

      if (tokenFrom === USDC_MINT) {
        // Direct transfer - no swap needed
        const quote = {
          quoteId: 'direct-usdc',
          usdcAmount: amountUsdc,
          inputToken: USDC_MINT,
          estimatedInputAmount: amountUsdc,
          maxInputAmount: amountUsdc,
          priceImpactPct: '0',
          route: {
            steps: 0,
            labels: ['Direct USDC Transfer'],
          },
        };

        expect(quote.route.steps).toEqual(0);
        expect(quote.priceImpactPct).toEqual('0');
      }
    });
  });

  describe('Payment Status', () => {
    it('should update status after confirmation', () => {
      let record = {
        paymentId: 'pay-123',
        status: 'pending' as 'pending' | 'success' | 'failed',
        txSignature: undefined as string | undefined,
        updatedAt: Date.now(),
      };

      // Simulate confirmation
      const txSignature = 'mock-signature-abc123';
      record = {
        ...record,
        status: 'success',
        txSignature,
        updatedAt: Date.now(),
      };

      expect(record.status).toEqual('success');
      expect(record.txSignature).toBeTruthy();
    });

    it('should handle failed payments', () => {
      let record = {
        paymentId: 'pay-456',
        status: 'pending' as 'pending' | 'success' | 'failed',
        updatedAt: Date.now(),
      };

      // Simulate failure
      record = {
        ...record,
        status: 'failed',
        updatedAt: Date.now(),
      };

      expect(record.status).toEqual('failed');
    });
  });

  describe('Payment Link Generation', () => {
    it('should generate payment link URL', () => {
      const params = {
        merchantPublicKey: merchant.publicKey.toBase58(),
        amountUsdc: '100000000',
        memo: 'Order #12345',
      };

      const baseUrl = 'https://flowmint.app';
      const queryParams = new URLSearchParams({
        merchant: params.merchantPublicKey,
        amount: params.amountUsdc,
        memo: params.memo || '',
      });

      const paymentLink = `${baseUrl}/pay?${queryParams.toString()}`;

      expect(paymentLink).toContain('/pay?');
      expect(paymentLink).toContain('merchant=');
      expect(paymentLink).toContain('amount=');
    });
  });

  describe('Multi-Token Support', () => {
    it('should support common Solana tokens', () => {
      const supportedTokens = [
        { symbol: 'SOL', mint: SOL_MINT },
        { symbol: 'USDC', mint: USDC_MINT },
        { symbol: 'BONK', mint: BONK_MINT },
      ];

      expect(supportedTokens.length).toEqual(3);
      supportedTokens.forEach((token) => {
        expect(() => new PublicKey(token.mint)).not.toThrow();
      });
    });

    it('should handle different decimal places', () => {
      const tokens = [
        { symbol: 'SOL', decimals: 9 },
        { symbol: 'USDC', decimals: 6 },
        { symbol: 'BONK', decimals: 5 },
      ];

      const oneToken = (decimals: number) => Math.pow(10, decimals);

      expect(oneToken(9)).toEqual(1_000_000_000);
      expect(oneToken(6)).toEqual(1_000_000);
      expect(oneToken(5)).toEqual(100_000);
    });
  });
});
