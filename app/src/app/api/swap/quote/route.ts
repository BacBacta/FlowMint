/**
 * Swap Quote API Route (Proxy)
 *
 * Proxies quote requests to the FlowMint backend server.
 */

import { NextRequest, NextResponse } from 'next/server';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json(
      { error: 'Backend server not configured. Set NEXT_PUBLIC_API_URL.' },
      { status: 503, headers: corsHeaders }
    );
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const inputMint = searchParams.get('inputMint');
    const outputMint = searchParams.get('outputMint');
    const amount = searchParams.get('amount');
    const slippageBps = searchParams.get('slippageBps') || '50';

    if (!inputMint || !outputMint || !amount) {
      return NextResponse.json(
        { error: 'Missing required parameters: inputMint, outputMint, amount' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Proxy to backend
    const backendUrl = new URL(`${backend}/api/v1/swap/quote`);
    backendUrl.searchParams.set('inputMint', inputMint);
    backendUrl.searchParams.set('outputMint', outputMint);
    backendUrl.searchParams.set('amount', amount);
    backendUrl.searchParams.set('slippageBps', slippageBps);

    const response = await fetch(backendUrl.toString(), {
      headers: { Accept: 'application/json' },
    });

    const payload = await response.json().catch(() => ({ error: 'Invalid backend response' }));

    return NextResponse.json(payload, {
      status: response.status,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('Quote proxy error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 502, headers: corsHeaders }
    );
  }
}
