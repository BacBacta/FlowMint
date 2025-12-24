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
  return NextResponse.json(
    {
      success: false,
      error: 'Intent creation requires the FlowMint backend server.',
      hint: 'Run: cd server && npm run dev',
    },
    { status: 503, headers: corsHeaders }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: { userPublicKey: string } }
) {
  // Return empty array for user intents
  return NextResponse.json([], { headers: corsHeaders });
}
