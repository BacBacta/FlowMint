'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// Common tokens for multi-token selection
const COMMON_TOKENS = [
  { mint: WSOL_MINT, symbol: 'SOL', name: 'Wrapped SOL' },
  { mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin' },
  { mint: USDT_MINT, symbol: 'USDT', name: 'Tether' },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade SOL' },
  { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', symbol: 'JitoSOL', name: 'Jito SOL' },
];

type PaymentLinkResponse = {
  success: boolean;
  paymentId: string;
  paymentUrl: string;
  qrCode: string;
  expiresAt: string;
};

type PaymentStatus = {
  paymentId: string;
  merchantId: string;
  orderId?: string;
  amountUsdc: string;
  status: 'pending' | 'completed' | 'expired' | 'failed';
  expiresAt?: number;
  txSignature?: string;
};

type MultiTokenLeg = {
  legIndex: number;
  payMint: string;
  amountIn: string;
  expectedUsdcOut: string;
  priceImpactPct: string;
  risk: string;
};

type MultiTokenQuote = {
  reservationId: string;
  invoiceId: string;
  strategy: string;
  legs: MultiTokenLeg[];
  totalAmountIn: string;
  totalExpectedUsdcOut: string;
  settlementAmount: string;
  aggregateRisk: string;
  expiresAt: number;
};

type GaslessEligibility = {
  eligible: boolean;
  reason?: string;
  limits?: { daily: number; remaining: number };
};

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function PaymentsContent() {
  const searchParams = useSearchParams();
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'create' | 'pay'>('create');

  // Merchant form state
  const [merchantId, setMerchantId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [amountUsdc, setAmountUsdc] = useState('');

  const merchantIdTrimmed = useMemo(() => merchantId.trim(), [merchantId]);
  const orderIdTrimmed = useMemo(() => orderId.trim(), [orderId]);
  const amountUsdcNumber = useMemo(() => Number(amountUsdc), [amountUsdc]);

  const isLikelySolanaAddress = useMemo(() => {
    // Base58 alphabet without 0, O, I, l
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantIdTrimmed);
  }, [merchantIdTrimmed]);

  const isAmountUsdcValid = useMemo(() => {
    return Number.isFinite(amountUsdcNumber) && amountUsdcNumber > 0;
  }, [amountUsdcNumber]);

  // Payment link state
  const [paymentId, setPaymentId] = useState('');
  const [paymentLink, setPaymentLink] = useState<any>(null);

  // Multi-token state
  const [useMultiToken, setUseMultiToken] = useState(false);
  const [selectedTokens, setSelectedTokens] = useState<string[]>([WSOL_MINT]);
  const [multiTokenQuote, setMultiTokenQuote] = useState<MultiTokenQuote | null>(null);
  const [currentLegIndex, setCurrentLegIndex] = useState(0);

  // Gasless state
  const [gaslessEligibility, setGaslessEligibility] = useState<GaslessEligibility | null>(null);
  const [useGasless, setUseGasless] = useState(false);

  useEffect(() => {
    const tab = searchParams.get('tab');
    const pid = searchParams.get('paymentId');
    if (tab === 'pay') setActiveTab('pay');
    if (pid) {
      setPaymentId(pid);
      setActiveTab('pay');
    }
  }, [searchParams]);

  const createLinkPayload = useMemo(
    () => ({ merchantId: merchantIdTrimmed, orderId: orderIdTrimmed, amountUsdc: amountUsdcNumber }),
    [merchantIdTrimmed, orderIdTrimmed, amountUsdcNumber]
  );

  // Create payment link mutation
  const createPaymentLink = useMutation({
    mutationFn: async () => {
      if (!isLikelySolanaAddress) {
        throw new Error('Merchant wallet address invalide (adresse Solana attendue)');
      }
      if (!orderIdTrimmed) {
        throw new Error('Order ID requis');
      }
      if (!isAmountUsdcValid) {
        throw new Error('Montant USDC invalide');
      }

      const resp = await fetch('/api/payments/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createLinkPayload),
      });
      const data = (await resp.json()) as PaymentLinkResponse | { success: false; error?: string };
      if (!resp.ok || !('success' in data) || data.success === false) {
        const message = (data as any)?.error || `HTTP ${resp.status}`;
        throw new Error(message);
      }
      return data;
    },
    onSuccess: data => {
      setPaymentLink(data);
    },
  });

  // Fetch payment status
  const { data: paymentStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['paymentStatus', paymentId],
    queryFn: async () => {
      if (!paymentId) return null;
      const resp = await fetch(`/api/payments/${encodeURIComponent(paymentId)}`);
      if (resp.status === 404) return null;
      const payload = (await resp.json()) as any;
      if (!resp.ok || payload?.success === false) {
        throw new Error(payload?.error || `HTTP ${resp.status}`);
      }
      return (payload.data || null) as PaymentStatus | null;
    },
    enabled: !!paymentId && activeTab === 'pay',
  });

  const payMutation = useMutation({
    mutationFn: async () => {
      if (!publicKey || !sendTransaction) {
        throw new Error('Wallet not connected');
      }
      if (!paymentId) {
        throw new Error('Missing paymentId');
      }

      const execResp = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerPublicKey: publicKey.toBase58(),
          payerMint: selectedTokens[0] || WSOL_MINT,
        }),
      });

      const execPayload = (await execResp.json()) as any;
      if (!execResp.ok || execPayload?.success === false) {
        throw new Error(execPayload?.error || `HTTP ${execResp.status}`);
      }

      const txBase64 = execPayload?.data?.transaction as string | undefined;
      const lastValidBlockHeight = execPayload?.data?.lastValidBlockHeight as number | undefined;
      if (!txBase64) {
        throw new Error('Missing transaction');
      }

      const txBytes = base64ToUint8Array(txBase64);
      const tx = VersionedTransaction.deserialize(txBytes);
      const signature = await sendTransaction(tx, connection);

      // Confirm on-chain (best effort)
      try {
        const blockhash = (tx.message as any).recentBlockhash as string | undefined;
        if (blockhash && typeof lastValidBlockHeight === 'number') {
          await connection.confirmTransaction(
            { signature, blockhash, lastValidBlockHeight },
            'confirmed'
          );
        } else {
          await connection.confirmTransaction(signature, 'confirmed');
        }
      } catch {
        // Even if confirm fails client-side, still attempt to report signature.
      }

      await fetch('/api/payments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, txSignature: signature, success: true }),
      });

      return signature;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentStatus', paymentId] });
    },
  });

  // Check gasless eligibility
  const checkGaslessEligibility = async (payMint: string) => {
    if (!publicKey) return;
    try {
      const resp = await fetch(
        `/api/v1/relayer/eligibility?payerPublicKey=${publicKey.toBase58()}&payMint=${payMint}`
      );
      if (resp.ok) {
        const data = await resp.json();
        setGaslessEligibility(data);
        // Auto-enable gasless if eligible for USDC/USDT
        if (data.eligible && (payMint === USDC_MINT || payMint === USDT_MINT)) {
          setUseGasless(true);
        }
      }
    } catch {
      setGaslessEligibility(null);
    }
  };

  // Multi-token quote mutation
  const getMultiTokenQuote = useMutation({
    mutationFn: async () => {
      if (!publicKey || !paymentId || selectedTokens.length === 0) {
        throw new Error('Missing required parameters');
      }

      const resp = await fetch('/api/v1/payments/quote-multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: paymentId,
          payerPublicKey: publicKey.toBase58(),
          payMints: selectedTokens,
          strategy: 'min-risk',
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }
      return data as MultiTokenQuote;
    },
    onSuccess: data => {
      setMultiTokenQuote(data);
      setCurrentLegIndex(0);
    },
  });

  // Execute single leg mutation
  const executeLeg = useMutation({
    mutationFn: async (legIndex: number) => {
      if (!multiTokenQuote || !publicKey) {
        throw new Error('No quote available');
      }

      const resp = await fetch('/api/v1/payments/execute-leg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservationId: multiTokenQuote.reservationId,
          legIndex,
        }),
      });

      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }
      return data;
    },
    onSuccess: data => {
      if (data.progress?.percentComplete === 100) {
        queryClient.invalidateQueries({ queryKey: ['paymentStatus', paymentId] });
      } else {
        setCurrentLegIndex(prev => prev + 1);
      }
    },
  });

  // Gasless payment mutation
  const payGasless = useMutation({
    mutationFn: async () => {
      if (!publicKey || !paymentId) {
        throw new Error('Wallet not connected or missing payment ID');
      }

      // First get the transaction to sign
      const execResp = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerPublicKey: publicKey.toBase58(),
          payerMint: selectedTokens[0] || USDC_MINT,
          gasless: true,
        }),
      });

      const execPayload = await execResp.json();
      if (!execResp.ok || execPayload?.success === false) {
        throw new Error(execPayload?.error || `HTTP ${execResp.status}`);
      }

      const txBase64 = execPayload?.data?.transaction as string;
      if (!txBase64) {
        throw new Error('Missing transaction');
      }

      // Sign the transaction (user signs, relayer pays gas)
      const txBytes = base64ToUint8Array(txBase64);
      const tx = VersionedTransaction.deserialize(txBytes);
      const signedTx = await sendTransaction(tx, connection, { skipPreflight: true });

      // Submit to relayer
      const submitResp = await fetch('/api/v1/relayer/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: paymentId,
          payerPublicKey: publicKey.toBase58(),
          signedTransaction: signedTx,
        }),
      });

      const submitData = await submitResp.json();
      if (!submitResp.ok || !submitData.success) {
        throw new Error(submitData?.error || 'Gasless submission failed');
      }

      return submitData.signature;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentStatus', paymentId] });
    },
  });

  // Toggle token selection for multi-token
  const toggleToken = (mint: string) => {
    setSelectedTokens(prev => {
      if (prev.includes(mint)) {
        return prev.filter(m => m !== mint);
      }
      if (prev.length >= 2) {
        return [prev[1], mint]; // Replace first with second, add new
      }
      return [...prev, mint];
    });
    setMultiTokenQuote(null);
  };

  // Effect to check gasless eligibility when token changes
  useEffect(() => {
    if (publicKey && selectedTokens.length === 1) {
      checkGaslessEligibility(selectedTokens[0]);
    }
  }, [publicKey, selectedTokens]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 py-8">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Page Header */}
          <div className="mb-8 text-center">
            <h1 className="text-surface-900 text-3xl font-bold dark:text-white">
              Pay Any Token → USDC
            </h1>
            <p className="text-surface-600 dark:text-surface-400 mt-2">
              Accept payments in any token, receive USDC automatically
            </p>
          </div>

          {/* Tabs */}
          <div className="mb-8 flex justify-center">
            <div className="bg-surface-100 dark:bg-surface-800 inline-flex rounded-lg p-1">
              <button
                onClick={() => setActiveTab('create')}
                className={`rounded-md px-6 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'create'
                    ? 'text-surface-900 dark:bg-surface-700 bg-white shadow dark:text-white'
                    : 'text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white'
                }`}
              >
                Create Payment Link
              </button>
              <button
                onClick={() => setActiveTab('pay')}
                className={`rounded-md px-6 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'pay'
                    ? 'text-surface-900 dark:bg-surface-700 bg-white shadow dark:text-white'
                    : 'text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white'
                }`}
              >
                Pay Invoice
              </button>
            </div>
          </div>

          {/* Create Payment Link Tab */}
          {activeTab === 'create' && (
            <div className="grid gap-8 lg:grid-cols-2">
              {/* Form */}
              <div className="card">
                <h2 className="text-surface-900 mb-6 text-xl font-semibold dark:text-white">
                  Create Payment Link
                </h2>

                <div className="space-y-6">
                  {/* Merchant ID */}
                  <div>
                    <label className="label mb-2">Merchant Wallet (Solana address)</label>
                    <input
                      type="text"
                      value={merchantId}
                      onChange={e => setMerchantId(e.target.value)}
                      placeholder="Base58 Solana public key"
                      className="input w-full"
                    />
                    {!merchantIdTrimmed ? null : !isLikelySolanaAddress ? (
                      <p className="text-sm text-red-500 mt-2">
                        Doit être une adresse Solana valide (base58, ~32–44 caractères).
                      </p>
                    ) : null}
                  </div>

                  {/* Order ID */}
                  <div>
                    <label className="label mb-2">Order ID / Invoice Number</label>
                    <input
                      type="text"
                      value={orderId}
                      onChange={e => setOrderId(e.target.value)}
                      placeholder="INV-001"
                      className="input w-full"
                    />
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="label mb-2">Amount (USDC)</label>
                    <input
                      type="number"
                      value={amountUsdc}
                      onChange={e => setAmountUsdc(e.target.value)}
                      placeholder="100.00"
                      className="input w-full"
                      min={0}
                      step="0.01"
                    />
                    {!amountUsdc ? null : !isAmountUsdcValid ? (
                      <p className="text-sm text-red-500 mt-2">Le montant doit être strictement positif.</p>
                    ) : null}
                  </div>

                  {/* Submit Button */}
                  <button
                    onClick={() => createPaymentLink.mutate()}
                    disabled={
                      !merchantIdTrimmed ||
                      !isLikelySolanaAddress ||
                      !orderIdTrimmed ||
                      !amountUsdc ||
                      !isAmountUsdcValid ||
                      createPaymentLink.isPending
                    }
                    className="btn-primary w-full py-3"
                  >
                    {createPaymentLink.isPending ? 'Creating...' : 'Create Payment Link'}
                  </button>

                  {createPaymentLink.isError && (
                    <div className="text-sm text-red-500">
                      {(createPaymentLink.error as Error).message}
                    </div>
                  )}
                </div>
              </div>

              {/* Result */}
              <div className="card">
                <h2 className="text-surface-900 mb-6 text-xl font-semibold dark:text-white">
                  Payment Link
                </h2>

                {!paymentLink ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <svg
                      className="text-surface-400 h-12 w-12"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                      />
                    </svg>
                    <p className="text-surface-600 dark:text-surface-400 mt-4">
                      Create a payment link to see it here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-surface-50 dark:bg-surface-900 rounded-lg p-4">
                      <div className="text-surface-600 dark:text-surface-400 text-sm">
                        Payment ID
                      </div>
                      <div className="text-surface-900 mt-1 font-mono text-sm dark:text-white">
                        {paymentLink.paymentId}
                      </div>
                    </div>

                    <div className="bg-surface-50 dark:bg-surface-900 rounded-lg p-4">
                      <div className="text-surface-600 dark:text-surface-400 text-sm">
                        Payment URL
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={paymentLink.paymentUrl}
                          readOnly
                          className="input flex-1 text-sm"
                        />
                        <button
                          onClick={() => navigator.clipboard.writeText(paymentLink.paymentUrl)}
                          className="btn-secondary px-3 py-2"
                        >
                          Copy
                        </button>
                      </div>
                    </div>

                    <div className="bg-surface-50 dark:bg-surface-900 rounded-lg p-4">
                      <div className="text-surface-600 dark:text-surface-400 text-sm">Expires</div>
                      <div className="text-surface-900 mt-1 text-sm dark:text-white">
                        {new Date(paymentLink.expiresAt).toLocaleString()}
                      </div>
                    </div>

                    {/* QR Code Placeholder */}
                    <div className="flex justify-center">
                      <div className="dark:bg-surface-700 flex h-32 w-32 items-center justify-center rounded-lg bg-white">
                        <span className="text-surface-400 text-xs">QR Code</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pay Invoice Tab */}
          {activeTab === 'pay' && (
            <div className="card mx-auto max-w-xl">
              <h2 className="text-surface-900 mb-6 text-xl font-semibold dark:text-white">
                Pay Invoice
              </h2>

              {!connected ? (
                <div className="text-surface-600 dark:text-surface-400 py-8 text-center">
                  Connect your wallet to pay invoices
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Payment ID Input */}
                  <div>
                    <label className="label mb-2">Payment ID</label>
                    <input
                      type="text"
                      value={paymentId}
                      onChange={e => setPaymentId(e.target.value)}
                      placeholder="Enter payment ID"
                      className="input w-full"
                    />
                  </div>

                  {/* Payment Status */}
                  {paymentId && (
                    <div className="bg-surface-50 dark:bg-surface-900 rounded-lg p-4">
                      {statusLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <svg
                            className="text-primary-500 h-6 w-6 animate-spin"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                        </div>
                      ) : paymentStatus ? (
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-surface-600 dark:text-surface-400">Amount</span>
                            <span className="text-surface-900 font-medium dark:text-white">
                              ${paymentStatus.amountUsdc} USDC
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-surface-600 dark:text-surface-400">Status</span>
                            <span
                              className={`badge ${
                                paymentStatus.status === 'completed'
                                  ? 'badge-success'
                                  : paymentStatus.status === 'pending'
                                    ? 'badge-warning'
                                    : 'badge-danger'
                              }`}
                            >
                              {paymentStatus.status}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-surface-600 dark:text-surface-400">Merchant</span>
                            <span className="text-surface-900 dark:text-white">
                              {paymentStatus.merchantId}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-surface-600 dark:text-surface-400 text-center">
                          Payment not found
                        </div>
                      )}
                    </div>
                  )}

                  {/* How it works */}
                  <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-4">
                    <h3 className="text-primary-800 dark:text-primary-200 font-medium">
                      PortfolioPay V1.5 Features
                    </h3>
                    <ul className="text-primary-700 dark:text-primary-300 mt-2 space-y-1 text-sm">
                      <li>• Pay using any token in your wallet</li>
                      <li>• <strong>Multi-token:</strong> Split payment across 2 tokens</li>
                      <li>• We automatically swap to USDC via Jupiter</li>
                      <li>• Merchant receives exact USDC amount (ExactOut)</li>
                      <li>
                        •{' '}
                        <span className="font-semibold text-green-600 dark:text-green-400">
                          Gasless
                        </span>
                        : Pay with 0 SOL (USDC/USDT only)
                      </li>
                      <li>
                        •{' '}
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          Attestation
                        </span>
                        : Cryptographic proof of policy compliance
                      </li>
                      <li>• Fast, MEV-protected transactions on Solana</li>
                    </ul>
                  </div>

                  {/* Token Selection */}
                  {paymentStatus?.status === 'pending' && (
                    <div className="space-y-4">
                      {/* Multi-token toggle */}
                      <div className="flex items-center justify-between">
                        <label className="label">Use multiple tokens</label>
                        <button
                          onClick={() => {
                            setUseMultiToken(!useMultiToken);
                            setMultiTokenQuote(null);
                            if (!useMultiToken) {
                              setSelectedTokens([WSOL_MINT]);
                            }
                          }}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            useMultiToken ? 'bg-primary-500' : 'bg-surface-300 dark:bg-surface-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              useMultiToken ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>

                      {/* Token selection */}
                      <div>
                        <label className="label mb-2">
                          {useMultiToken ? 'Select up to 2 tokens' : 'Select payment token'}
                        </label>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {COMMON_TOKENS.map(token => (
                            <button
                              key={token.mint}
                              onClick={() => toggleToken(token.mint)}
                              className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-colors ${
                                selectedTokens.includes(token.mint)
                                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                  : 'border-surface-200 hover:border-surface-300 dark:border-surface-700'
                              }`}
                            >
                              <div className="flex-1">
                                <div className="font-medium text-surface-900 dark:text-white">
                                  {token.symbol}
                                </div>
                                <div className="text-xs text-surface-500">{token.name}</div>
                              </div>
                              {selectedTokens.includes(token.mint) && (
                                <svg
                                  className="h-5 w-5 text-primary-500"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Gasless indicator */}
                      {gaslessEligibility && (
                        <div
                          className={`flex items-center gap-2 rounded-lg p-3 ${
                            gaslessEligibility.eligible
                              ? 'bg-green-50 dark:bg-green-900/20'
                              : 'bg-surface-100 dark:bg-surface-800'
                          }`}
                        >
                          {gaslessEligibility.eligible ? (
                            <>
                              <svg
                                className="h-5 w-5 text-green-500"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              <div className="flex-1">
                                <div className="font-medium text-green-700 dark:text-green-300">
                                  Gasless Available!
                                </div>
                                <div className="text-xs text-green-600 dark:text-green-400">
                                  Pay with 0 SOL - we cover the gas fees
                                </div>
                              </div>
                              <button
                                onClick={() => setUseGasless(!useGasless)}
                                className={`rounded-md px-3 py-1 text-sm font-medium ${
                                  useGasless
                                    ? 'bg-green-500 text-white'
                                    : 'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-200'
                                }`}
                              >
                                {useGasless ? 'Enabled' : 'Enable'}
                              </button>
                            </>
                          ) : (
                            <>
                              <svg
                                className="h-5 w-5 text-surface-400"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              <div className="text-sm text-surface-600 dark:text-surface-400">
                                Gasless requires USDC or USDT
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Multi-token quote section */}
                      {useMultiToken && selectedTokens.length > 0 && (
                        <div className="space-y-4">
                          <button
                            onClick={() => getMultiTokenQuote.mutate()}
                            disabled={getMultiTokenQuote.isPending}
                            className="btn-secondary w-full"
                          >
                            {getMultiTokenQuote.isPending ? 'Getting quote...' : 'Get Multi-Token Quote'}
                          </button>

                          {getMultiTokenQuote.isError && (
                            <div className="text-sm text-red-500">
                              {(getMultiTokenQuote.error as Error).message}
                            </div>
                          )}

                          {/* Quote result with legs table */}
                          {multiTokenQuote && (
                            <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4">
                              <h4 className="mb-3 font-medium text-surface-900 dark:text-white">
                                Payment Plan ({multiTokenQuote.strategy})
                              </h4>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-surface-500">
                                    <th className="pb-2">Leg</th>
                                    <th className="pb-2">Token</th>
                                    <th className="pb-2">Amount</th>
                                    <th className="pb-2">→ USDC</th>
                                    <th className="pb-2">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {multiTokenQuote.legs.map((leg, idx) => (
                                    <tr
                                      key={idx}
                                      className={
                                        idx === currentLegIndex ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                                      }
                                    >
                                      <td className="py-2">{leg.legIndex + 1}</td>
                                      <td className="py-2 font-mono text-xs">
                                        {COMMON_TOKENS.find(t => t.mint === leg.payMint)?.symbol ||
                                          leg.payMint.slice(0, 6)}
                                      </td>
                                      <td className="py-2">{parseFloat(leg.amountIn).toFixed(4)}</td>
                                      <td className="py-2">${leg.expectedUsdcOut}</td>
                                      <td className="py-2">
                                        {idx < currentLegIndex ? (
                                          <span className="badge badge-success">Done</span>
                                        ) : idx === currentLegIndex ? (
                                          <span className="badge badge-warning">Next</span>
                                        ) : (
                                          <span className="badge">Pending</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="mt-3 flex justify-between border-t border-surface-200 pt-3 dark:border-surface-700">
                                <span className="text-surface-600 dark:text-surface-400">Total</span>
                                <span className="font-medium text-surface-900 dark:text-white">
                                  ${multiTokenQuote.totalExpectedUsdcOut} USDC
                                </span>
                              </div>

                              {(() => {
                                const isInt = (v: string) => /^\d+$/.test(v);
                                if (
                                  !isInt(multiTokenQuote.totalExpectedUsdcOut) ||
                                  !isInt(multiTokenQuote.settlementAmount)
                                ) {
                                  return null;
                                }
                                const surplus =
                                  BigInt(multiTokenQuote.totalExpectedUsdcOut) -
                                  BigInt(multiTokenQuote.settlementAmount);
                                if (surplus <= 0n) return null;
                                return (
                                  <div className="mt-2 text-sm text-surface-600 dark:text-surface-400">
                                    Surplus estimé : ${surplus.toString()} USDC sera remboursé après règlement.
                                  </div>
                                );
                              })()}

                              {/* Execute Leg Button */}
                              {currentLegIndex < multiTokenQuote.legs.length && (
                                <button
                                  onClick={() => executeLeg.mutate(currentLegIndex)}
                                  disabled={executeLeg.isPending}
                                  className="btn-primary mt-4 w-full"
                                >
                                  {executeLeg.isPending
                                    ? `Executing Leg ${currentLegIndex + 1}...`
                                    : `Execute Leg ${currentLegIndex + 1} of ${multiTokenQuote.legs.length}`}
                                </button>
                              )}

                              {executeLeg.isError && (
                                <div className="mt-2 text-sm text-red-500">
                                  {(executeLeg.error as Error).message}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Pay Buttons */}
                  {!useMultiToken && (
                    <div className="space-y-3">
                      {/* Gasless Pay Button */}
                      {useGasless && gaslessEligibility?.eligible && (
                        <button
                          onClick={() => payGasless.mutate()}
                          disabled={
                            !paymentStatus ||
                            paymentStatus?.status !== 'pending' ||
                            payGasless.isPending
                          }
                          className="w-full rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {payGasless.isPending ? (
                            <span className="flex items-center justify-center gap-2">
                              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                  fill="none"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                />
                              </svg>
                              Paying Gasless...
                            </span>
                          ) : (
                            <>⚡ Pay Gasless - ${paymentStatus?.amountUsdc || '0'} USDC</>
                          )}
                        </button>
                      )}

                      {payGasless.isError && (
                        <div className="text-sm text-red-500">
                          {(payGasless.error as Error).message}
                        </div>
                      )}

                      {/* Regular Pay Button */}
                      <button
                        onClick={() => payMutation.mutate()}
                        disabled={
                          !paymentStatus || paymentStatus?.status !== 'pending' || payMutation.isPending
                        }
                        className="btn-primary w-full py-3"
                      >
                        {paymentStatus?.status === 'completed'
                          ? 'Already Paid'
                          : paymentStatus?.status === 'expired'
                            ? 'Payment Expired'
                            : payMutation.isPending
                              ? 'Paying...'
                              : useGasless
                                ? `Pay with Gas - $${paymentStatus?.amountUsdc || '0'} USDC`
                                : `Pay $${paymentStatus?.amountUsdc || '0'} USDC`}
                      </button>

                      {payMutation.isError && (
                        <div className="text-sm text-red-500">
                          {(payMutation.error as Error).message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
export default function PaymentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
          <div className="text-white">Loading...</div>
        </div>
      }
    >
      <PaymentsContent />
    </Suspense>
  );
}
