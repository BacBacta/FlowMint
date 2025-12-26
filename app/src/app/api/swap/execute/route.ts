/**
 * Swap Execute API Route (Proxy)
 *
 * Proxies swap execution requests to the FlowMint backend server.
 */

import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json(
      {
        success: false,
        error: 'Backend server not configured. Set NEXT_PUBLIC_API_URL.',
      },
      { status: 503, headers: corsHeaders }
    );
  }

  try {
    const body = await request.json();

    const resp = await fetch(`${backend}/api/v1/swap/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = await resp.json().catch(() => ({ error: 'Invalid backend response' }));

    return NextResponse.json(payload, {
      status: resp.status,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('Execute swap proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 502, headers: corsHeaders }
    );
  }
}
