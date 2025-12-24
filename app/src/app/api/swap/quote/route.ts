/**
 * Swap Quote API Route
 *
 * Proxies quote requests to Jupiter API
 */

import { NextRequest, NextResponse } from 'next/server';

const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6';

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

    // Build Jupiter quote URL
    const jupiterUrl = new URL(`${JUPITER_API_URL}/quote`);
    jupiterUrl.searchParams.set('inputMint', inputMint);
    jupiterUrl.searchParams.set('outputMint', outputMint);
    jupiterUrl.searchParams.set('amount', amount);
    jupiterUrl.searchParams.set('slippageBps', slippageBps);

    // Fetch from Jupiter
    const response = await fetch(jupiterUrl.toString(), {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Jupiter API error: ${errorText}` },
        { status: response.status, headers: corsHeaders }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { headers: corsHeaders });
  } catch (error) {
    console.error('Quote error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
