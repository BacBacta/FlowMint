/**
 * Payment Create Link API Route
 *
 * Creates a payment link. Requires backend.
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
  return NextResponse.json(
    {
      success: false,
      error: 'Payment creation requires the FlowMint backend server.',
      hint: 'Run: cd server && npm run dev',
    },
    { status: 503, headers: corsHeaders }
  );
}
