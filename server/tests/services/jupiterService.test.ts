import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { jupiterService } from '../../src/services/jupiterService';

// Mock fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('JupiterService', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('quoteSwap', () => {
    it('should get a quote successfully', async () => {
      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '150000000',
        priceImpactPct: '0.001',
        slippageBps: 50,
        routePlan: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuote,
      } as Response);

      const result = await jupiterService.quoteSwap({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1_000_000_000,
        slippageBps: 50,
      });

      expect(result).toEqual(mockQuote);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('inputMint=So11111111111111111111111111111111111111112'),
        expect.any(Object),
      );
    });

    it('should handle quote errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'No route found' }),
      } as Response);

      await expect(
        jupiterService.quoteSwap({
          inputMint: 'invalid',
          outputMint: 'invalid',
          amount: 1000,
          slippageBps: 50,
        }),
      ).rejects.toThrow();
    });

    it('should respect slippage parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ inAmount: '1000', outAmount: '100', slippageBps: 100 }),
      } as Response);

      await jupiterService.quoteSwap({
        inputMint: 'mint1',
        outputMint: 'mint2',
        amount: 1000,
        slippageBps: 100,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('slippageBps=100'),
        expect.any(Object),
      );
    });
  });

  describe('getSwapTransaction', () => {
    it('should get swap transaction', async () => {
      const mockQuote = { inAmount: '1000', outAmount: '100' };
      const mockSwapTx = { swapTransaction: 'base64-encoded-tx' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSwapTx,
      } as Response);

      const result = await jupiterService.getSwapTransaction(mockQuote as any, 'userPubkey');

      expect(result).toEqual(mockSwapTx);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/swap'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('userPubkey'),
        }),
      );
    });
  });

  describe('getTokenList', () => {
    it('should get token list', async () => {
      const mockTokens = [
        { address: 'mint1', symbol: 'SOL', name: 'Solana', decimals: 9 },
        { address: 'mint2', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokens,
      } as Response);

      const result = await jupiterService.getTokenList();

      expect(result).toEqual(mockTokens);
    });
  });
});
