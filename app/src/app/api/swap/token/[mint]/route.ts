/**
 * Swap Token Resolve API Route (Proxy)
 *
 * Proxies requests to backend /api/v1/swap/token/:mint
 * so the UI can resolve custom token mints.
 */

import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(_request: NextRequest, context: { params: { mint: string } }) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json({ error: 'Missing NEXT_PUBLIC_API_URL' }, { status: 503, headers: corsHeaders });
  }

  const mint = context.params.mint;

  try {
    const resp = await fetch(`${backend}/api/v1/swap/token/${encodeURIComponent(mint)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const payload = await resp.json().catch(() => ({ error: 'Invalid backend response' }));

    return NextResponse.json(payload, {
      status: resp.status,
      headers: corsHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to resolve token: ${message}` },
      { status: 502, headers: corsHeaders }
    );
  }
}
