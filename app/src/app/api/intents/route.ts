/**
 * Intent API Route
 *
 * Handles DCA and Stop-Loss intent creation. Requires backend.
 */

import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json(
      { success: false, error: 'Backend server not configured. Set NEXT_PUBLIC_API_URL.' },
      { status: 503, headers: corsHeaders }
    );
  }

  try {
    const body = await request.json();
    const type = body?.type;
    const target =
      type === 'dca'
        ? `${backend}/api/v1/intents/dca`
        : type === 'stop-loss'
          ? `${backend}/api/v1/intents/stop-loss`
          : null;

    if (!target) {
      return NextResponse.json(
        { success: false, error: 'Invalid intent type' },
        { status: 400, headers: corsHeaders }
      );
    }

    const resp = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = await resp.json().catch(() => ({ success: false, error: 'Invalid backend response' }));
    return NextResponse.json(payload, { status: resp.status, headers: corsHeaders });
  } catch (error) {
    console.error('Intents proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 502, headers: corsHeaders }
    );
  }
}
