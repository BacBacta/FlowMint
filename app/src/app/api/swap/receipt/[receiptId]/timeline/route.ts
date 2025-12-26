/**
 * Swap Receipt Timeline API Route (Proxy)
 *
 * Proxies requests to backend /api/v1/swap/receipt/:receiptId/timeline
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

export async function GET(_request: NextRequest, { params }: { params: { receiptId: string } }) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json(
      { success: false, error: 'Backend server not configured. Set NEXT_PUBLIC_API_URL.' },
      { status: 503, headers: corsHeaders }
    );
  }

  try {
    const receiptId = params.receiptId;
    const resp = await fetch(
      `${backend}/api/v1/swap/receipt/${encodeURIComponent(receiptId)}/timeline`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const payload = await resp
      .json()
      .catch(() => ({ success: false, error: 'Invalid backend response' }));

    return NextResponse.json(payload, {
      status: resp.status,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('Receipt timeline proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 502, headers: corsHeaders }
    );
  }
}
