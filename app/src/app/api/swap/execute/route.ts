/**
 * Swap Execute API Route
 *
 * Executes a swap transaction. In production, this would interact with
 * the FlowMint program. For now, returns a mock response.
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
  try {
    const body = await request.json();
    const {
      userPublicKey,
      inputMint,
      outputMint,
      amount,
      slippageBps: _slippageBps,
      protectedMode: _protectedMode,
    } = body;

    if (!userPublicKey || !inputMint || !outputMint || !amount) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters' },
        { status: 400, headers: corsHeaders }
      );
    }

    // TODO: Implement actual swap execution via FlowMint program
    // For now, return a message indicating the backend is needed
    return NextResponse.json(
      {
        success: false,
        error:
          'Swap execution requires the FlowMint backend server. Please run the server locally or deploy it.',
        hint: 'Run: cd server && npm run dev',
      },
      { status: 503, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Execute swap error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
