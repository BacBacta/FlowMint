/**
 * Notifications API Route (Next.js)
 *
 * This route keeps the frontend same-origin by proxying requests to the backend
 * (Fly.io / Express) under /api/v1/notifications/*.
 *
 * Frontend expectations (NotificationBell):
 * - GET /api/notifications/:userPublicKey?limit=20 -> { notifications: [...] }
 * - GET /api/notifications/:userPublicKey/unread-count -> { count: number }
 * - POST /api/notifications/:notificationId/read
 * - POST /api/notifications/:userPublicKey/read-all
 */

import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function getBackendBaseUrl(): string {
  // Prefer public backend URL (also available on the server runtime)
  return (
    process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || process.env.FLOWMINT_BACKEND_URL || ''
  );
}

function toBackendUrl(pathname: string, searchParams?: URLSearchParams): URL {
  const backendBaseUrl = getBackendBaseUrl();
  if (!backendBaseUrl) {
    throw new Error('Backend URL is not configured (NEXT_PUBLIC_API_URL)');
  }

  const url = new URL(pathname, backendBaseUrl);
  if (searchParams) {
    searchParams.forEach((value, key) => url.searchParams.set(key, value));
  }
  return url;
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ segments: string[] }> }
) {
  try {
    const { segments } = await context.params;

    // GET /api/notifications/:userPublicKey
    if (segments.length === 1) {
      const [userPublicKey] = segments;
      const forwardedParams = new URLSearchParams();
      const limit = request.nextUrl.searchParams.get('limit');
      const unreadOnly = request.nextUrl.searchParams.get('unreadOnly');
      if (limit) forwardedParams.set('limit', limit);
      if (unreadOnly) forwardedParams.set('unreadOnly', unreadOnly);

      const backendUrl = toBackendUrl(`/api/v1/notifications/${userPublicKey}`, forwardedParams);
      const response = await fetch(backendUrl.toString(), {
        headers: { Accept: 'application/json' },
      });

      const text = await response.text();
      if (!response.ok) {
        return NextResponse.json(
          { error: text || `HTTP ${response.status}` },
          { status: response.status, headers: corsHeaders }
        );
      }

      const payload = text ? JSON.parse(text) : {};
      const notifications = payload?.data?.notifications ?? payload?.notifications ?? [];
      const unreadCount = payload?.data?.unreadCount ?? payload?.unreadCount ?? 0;
      const total = payload?.data?.total ?? payload?.total ?? notifications.length;

      return NextResponse.json(
        { success: true, notifications, unreadCount, total },
        { headers: corsHeaders }
      );
    }

    // GET /api/notifications/:userPublicKey/unread-count
    if (segments.length === 2 && segments[1] === 'unread-count') {
      const userPublicKey = segments[0];
      const backendUrl = toBackendUrl(`/api/v1/notifications/${userPublicKey}/unread-count`);

      const response = await fetch(backendUrl.toString(), {
        headers: { Accept: 'application/json' },
      });

      const text = await response.text();
      if (!response.ok) {
        return NextResponse.json(
          { error: text || `HTTP ${response.status}` },
          { status: response.status, headers: corsHeaders }
        );
      }

      const payload = text ? JSON.parse(text) : {};
      const count = payload?.data?.count ?? payload?.count ?? 0;
      return NextResponse.json({ success: true, count }, { headers: corsHeaders });
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  } catch (error) {
    console.error('Notifications GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ segments: string[] }> }
) {
  try {
    const { segments } = await context.params;

    // POST /api/notifications/:id/read
    if (segments.length === 2 && segments[1] === 'read') {
      const id = segments[0];
      const backendUrl = toBackendUrl(`/api/v1/notifications/${id}/read`);

      const response = await fetch(backendUrl.toString(), {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });

      const text = await response.text();
      if (!response.ok) {
        return NextResponse.json(
          { error: text || `HTTP ${response.status}` },
          { status: response.status, headers: corsHeaders }
        );
      }

      return NextResponse.json({ success: true }, { headers: corsHeaders });
    }

    // POST /api/notifications/:userPublicKey/read-all
    if (segments.length === 2 && segments[1] === 'read-all') {
      const userPublicKey = segments[0];
      const backendUrl = toBackendUrl(`/api/v1/notifications/${userPublicKey}/read-all`);

      const response = await fetch(backendUrl.toString(), {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });

      const text = await response.text();
      if (!response.ok) {
        return NextResponse.json(
          { error: text || `HTTP ${response.status}` },
          { status: response.status, headers: corsHeaders }
        );
      }

      return NextResponse.json({ success: true }, { headers: corsHeaders });
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  } catch (error) {
    console.error('Notifications POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
