/**
 * FlowMint API - OpenAPI/Swagger Specification
 *
 * This file defines the complete API documentation for FlowMint,
 * an execution layer built on top of Jupiter DEX for Solana.
 */

import { OpenAPIV3 } from 'openapi-types';

export const openApiSpec: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'FlowMint API',
    version: '1.0.0',
    description: `
# FlowMint API

FlowMint is an advanced execution layer built on top of Jupiter DEX for Solana, providing:

- 🔄 **Smart Order Routing** - Optimal swap execution via Jupiter
- 💳 **Pay Any Token** - Pay for anything with any SPL token
- 🛡️ **Protected Mode** - MEV protection and slippage control
- 📊 **Analytics** - Transaction tracking and protocol metrics
- 🔔 **Notifications** - Real-time alerts for swaps and payments

## Authentication

Most endpoints require authentication via JWT token or wallet signature.

### JWT Authentication
Include the JWT token in the Authorization header:
\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

### Wallet Signature Authentication
1. Request a nonce from \`/api/auth/nonce\`
2. Sign the nonce with your wallet
3. Submit signature to \`/api/auth/login\` to receive JWT

## Rate Limits

- General API: 100 requests per minute
- Auth endpoints: 10 requests per minute
- Quote endpoints: 30 requests per minute

## WebSocket Events

Connect to \`/ws\` for real-time updates:
- \`swap:completed\` - Swap execution completed
- \`payment:received\` - Payment received
- \`price:update\` - Token price update
    `,
    contact: {
      name: 'FlowMint Team',
      url: 'https://github.com/flowmint/flowmint',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Development server',
    },
    {
      url: 'https://api.flowmint.io',
      description: 'Production server',
    },
  ],
  tags: [
    {
      name: 'Health',
      description: 'Health check endpoints',
    },
    {
      name: 'Auth',
      description: 'Authentication and authorization',
    },
    {
      name: 'Swap',
      description: 'Token swap operations via Jupiter',
    },
    {
      name: 'Payment',
      description: 'Pay Any Token functionality',
    },
    {
      name: 'Analytics',
      description: 'Protocol analytics and metrics',
    },
    {
      name: 'Notifications',
      description: 'Notification management',
    },
    {
      name: 'User',
      description: 'User preferences and settings',
    },
    {
      name: 'Risk',
      description: 'Risk assessment and protected mode',
    },
    {
      name: 'Intents',
      description: 'DCA and Stop-Loss intent management',
    },
    {
      name: 'Oracle',
      description: 'Price oracle data from Pyth',
    },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        description: 'Returns the health status of the API and its dependencies',
        operationId: 'healthCheck',
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/HealthResponse',
                },
                example: {
                  status: 'healthy',
                  timestamp: '2024-01-15T10:30:00Z',
                  version: '1.0.0',
                  dependencies: {
                    database: 'healthy',
                    solana: 'healthy',
                    jupiter: 'healthy',
                  },
                },
              },
            },
          },
          '503': {
            description: 'Service is unhealthy',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/HealthResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/nonce': {
      get: {
        tags: ['Auth'],
        summary: 'Get authentication nonce',
        description: 'Get a nonce to sign with your wallet for authentication',
        operationId: 'getNonce',
        parameters: [
          {
            name: 'wallet',
            in: 'query',
            required: true,
            description: 'Solana wallet public key',
            schema: {
              type: 'string',
              example: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Nonce generated successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NonceResponse',
                },
              },
            },
          },
          '400': {
            description: 'Invalid wallet address',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with wallet signature',
        description: 'Authenticate by signing a nonce with your Solana wallet',
        operationId: 'login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/LoginRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/LoginResponse',
                },
              },
            },
          },
          '401': {
            description: 'Invalid signature',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        description: 'Get a new access token using a refresh token',
        operationId: 'refreshToken',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: {
                    type: 'string',
                    description: 'The refresh token',
                  },
                },
                required: ['refreshToken'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Token refreshed successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/LoginResponse',
                },
              },
            },
          },
          '401': {
            description: 'Invalid or expired refresh token',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/swap/quote': {
      get: {
        tags: ['Swap'],
        summary: 'Get swap quote',
        description: 'Get a quote for swapping tokens via Jupiter',
        operationId: 'getSwapQuote',
        parameters: [
          {
            name: 'inputMint',
            in: 'query',
            required: true,
            description: 'Input token mint address',
            schema: {
              type: 'string',
              example: 'So11111111111111111111111111111111111111112',
            },
          },
          {
            name: 'outputMint',
            in: 'query',
            required: true,
            description: 'Output token mint address',
            schema: {
              type: 'string',
              example: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            },
          },
          {
            name: 'amount',
            in: 'query',
            required: true,
            description: 'Input amount in smallest unit (lamports for SOL)',
            schema: {
              type: 'string',
              example: '1000000000',
            },
          },
          {
            name: 'slippageBps',
            in: 'query',
            required: false,
            description: 'Slippage tolerance in basis points (default: 50)',
            schema: {
              type: 'integer',
              minimum: 0,
              maximum: 5000,
              default: 50,
            },
          },
          {
            name: 'onlyDirectRoutes',
            in: 'query',
            required: false,
            description: 'Only use direct routes (no multi-hop)',
            schema: {
              type: 'boolean',
              default: false,
            },
          },
        ],
        responses: {
          '200': {
            description: 'Quote retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SwapQuote',
                },
              },
            },
          },
          '400': {
            description: 'Invalid parameters',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/swap/execute': {
      post: {
        tags: ['Swap'],
        summary: 'Execute swap',
        description: 'Execute a token swap using a previously obtained quote',
        operationId: 'executeSwap',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/SwapExecuteRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Swap executed successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SwapExecuteResponse',
                },
              },
            },
          },
          '400': {
            description: 'Invalid request or quote expired',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/swap/history': {
      get: {
        tags: ['Swap'],
        summary: 'Get swap history',
        description: "Get the authenticated user's swap history",
        operationId: 'getSwapHistory',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 20,
            },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: {
              type: 'integer',
              minimum: 0,
              default: 0,
            },
          },
        ],
        responses: {
          '200': {
            description: 'Swap history retrieved',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SwapHistoryResponse',
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/payment/create': {
      post: {
        tags: ['Payment'],
        summary: 'Create payment request',
        description: 'Create a new payment request that can be paid with any token',
        operationId: 'createPayment',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreatePaymentRequest',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Payment request created',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PaymentRequest',
                },
              },
            },
          },
          '400': {
            description: 'Invalid parameters',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/payment/{paymentId}': {
      get: {
        tags: ['Payment'],
        summary: 'Get payment details',
        description: 'Get details of a payment request',
        operationId: 'getPayment',
        parameters: [
          {
            name: 'paymentId',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              format: 'uuid',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Payment details',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PaymentRequest',
                },
              },
            },
          },
          '404': {
            description: 'Payment not found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/payment/{paymentId}/pay': {
      post: {
        tags: ['Payment'],
        summary: 'Pay with any token',
        description: 'Pay a payment request using any SPL token',
        operationId: 'payWithAnyToken',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'paymentId',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              format: 'uuid',
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/PayWithTokenRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Payment successful',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PaymentResponse',
                },
              },
            },
          },
          '400': {
            description: 'Payment failed',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/analytics/overview': {
      get: {
        tags: ['Analytics'],
        summary: 'Get protocol overview',
        description: 'Get high-level protocol analytics and metrics',
        operationId: 'getAnalyticsOverview',
        responses: {
          '200': {
            description: 'Analytics overview',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AnalyticsOverview',
                },
              },
            },
          },
        },
      },
    },
    '/api/analytics/volume': {
      get: {
        tags: ['Analytics'],
        summary: 'Get volume analytics',
        description: 'Get trading volume over time',
        operationId: 'getVolumeAnalytics',
        parameters: [
          {
            name: 'period',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['1h', '24h', '7d', '30d', 'all'],
              default: '24h',
            },
          },
          {
            name: 'granularity',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['1m', '5m', '1h', '1d'],
              default: '1h',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Volume data',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/VolumeAnalytics',
                },
              },
            },
          },
        },
      },
    },
    '/api/analytics/user': {
      get: {
        tags: ['Analytics'],
        summary: 'Get user analytics',
        description: 'Get analytics for the authenticated user',
        operationId: 'getUserAnalytics',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'User analytics',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UserAnalytics',
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    // Intent endpoints (DCA and Stop-Loss)
    '/api/intents': {
      get: {
        tags: ['Intents'],
        summary: 'List user intents',
        description: 'Get all DCA and Stop-Loss intents for the authenticated user',
        operationId: 'listIntents',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'type',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['dca', 'stop_loss', 'limit_order'],
            },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['active', 'paused', 'completed', 'cancelled'],
            },
          },
        ],
        responses: {
          '200': {
            description: 'List of intents',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    intents: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Intent' },
                    },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Intents'],
        summary: 'Create DCA intent',
        description: 'Create a new Dollar Cost Averaging intent',
        operationId: 'createDCAIntent',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateDCARequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'DCA intent created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Intent' },
              },
            },
          },
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/api/intents/stop-loss': {
      post: {
        tags: ['Intents'],
        summary: 'Create Stop-Loss intent',
        description: 'Create a new Stop-Loss intent with oracle price monitoring',
        operationId: 'createStopLossIntent',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateStopLossRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Stop-Loss intent created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Intent' },
              },
            },
          },
        },
      },
    },
    '/api/intents/{id}': {
      get: {
        tags: ['Intents'],
        summary: 'Get intent details',
        operationId: 'getIntent',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Intent details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Intent' },
              },
            },
          },
          '404': {
            description: 'Intent not found',
          },
        },
      },
      delete: {
        tags: ['Intents'],
        summary: 'Cancel intent',
        operationId: 'cancelIntent',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Intent cancelled',
          },
        },
      },
    },
    '/api/intents/{id}/pause': {
      post: {
        tags: ['Intents'],
        summary: 'Pause intent',
        operationId: 'pauseIntent',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Intent paused',
          },
        },
      },
    },
    '/api/intents/{id}/resume': {
      post: {
        tags: ['Intents'],
        summary: 'Resume intent',
        operationId: 'resumeIntent',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Intent resumed',
          },
        },
      },
    },
    // Oracle endpoints
    '/api/oracle/prices': {
      get: {
        tags: ['Oracle'],
        summary: 'Get oracle prices',
        description: 'Fetch current prices from Pyth oracle for specified feeds',
        operationId: 'getOraclePrices',
        parameters: [
          {
            name: 'feedIds',
            in: 'query',
            required: true,
            description: 'Comma-separated list of Pyth price feed IDs',
            schema: {
              type: 'string',
              example: 'ef0d8b6f...,ff61491a...',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Oracle price data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    prices: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/OraclePrice' },
                    },
                    fetchedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/oracle/check-trigger': {
      post: {
        tags: ['Oracle'],
        summary: 'Check stop-loss trigger',
        description: 'Check if a stop-loss condition would be triggered at current price',
        operationId: 'checkStopLossTrigger',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['feedId', 'threshold', 'direction'],
                properties: {
                  feedId: { type: 'string' },
                  threshold: { type: 'number' },
                  direction: { type: 'string', enum: ['above', 'below'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Trigger check result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StopLossTriggerCheck' },
              },
            },
          },
        },
      },
    },
    // Risk Assessment endpoint
    '/api/risk/assess': {
      post: {
        tags: ['Risk'],
        summary: 'Assess swap risk',
        description: 'Get risk assessment for a swap quote using traffic light system',
        operationId: 'assessRisk',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SwapQuote' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Risk assessment',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RiskAssessment' },
              },
            },
          },
        },
      },
    },
    // Receipts endpoint
    '/api/receipts/{signature}': {
      get: {
        tags: ['Swap'],
        summary: 'Get transaction receipt',
        description: 'Get enhanced receipt for a completed swap transaction',
        operationId: 'getReceipt',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'signature',
            in: 'path',
            required: true,
            description: 'Solana transaction signature',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Transaction receipt',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EnhancedReceipt' },
              },
            },
          },
          '404': {
            description: 'Receipt not found',
          },
        },
      },
    },
    '/api/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'Get notifications',
        description: 'Get notifications for the authenticated user',
        operationId: 'getNotifications',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'unreadOnly',
            in: 'query',
            required: false,
            schema: {
              type: 'boolean',
              default: false,
            },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 20,
            },
          },
        ],
        responses: {
          '200': {
            description: 'Notifications list',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NotificationList',
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/notifications/{id}/read': {
      post: {
        tags: ['Notifications'],
        summary: 'Mark notification as read',
        description: 'Mark a specific notification as read',
        operationId: 'markNotificationRead',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Notification marked as read',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Notification not found',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/api/notifications/preferences': {
      get: {
        tags: ['Notifications'],
        summary: 'Get notification preferences',
        description: "Get the user's notification preferences",
        operationId: 'getNotificationPreferences',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Notification preferences',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NotificationPreferences',
                },
              },
            },
          },
        },
      },
      put: {
        tags: ['Notifications'],
        summary: 'Update notification preferences',
        description: "Update the user's notification preferences",
        operationId: 'updateNotificationPreferences',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/NotificationPreferences',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Preferences updated',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NotificationPreferences',
                },
              },
            },
          },
        },
      },
    },
    '/api/user/profile': {
      get: {
        tags: ['User'],
        summary: 'Get user profile',
        description: "Get the authenticated user's profile",
        operationId: 'getUserProfile',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'User profile',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UserProfile',
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      put: {
        tags: ['User'],
        summary: 'Update user profile',
        description: "Update the authenticated user's profile",
        operationId: 'updateUserProfile',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/UpdateProfileRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Profile updated',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UserProfile',
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained from /api/auth/login',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            description: 'Error code',
          },
          message: {
            type: 'string',
            description: 'Human-readable error message',
          },
          details: {
            type: 'object',
            description: 'Additional error details',
          },
        },
        required: ['error', 'message'],
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['healthy', 'unhealthy', 'degraded'],
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
          },
          version: {
            type: 'string',
          },
          dependencies: {
            type: 'object',
            additionalProperties: {
              type: 'string',
              enum: ['healthy', 'unhealthy'],
            },
          },
        },
      },
      NonceResponse: {
        type: 'object',
        properties: {
          nonce: {
            type: 'string',
            description: 'Nonce to sign with wallet',
          },
          expiresAt: {
            type: 'string',
            format: 'date-time',
            description: 'Nonce expiration time',
          },
        },
        required: ['nonce', 'expiresAt'],
      },
      LoginRequest: {
        type: 'object',
        properties: {
          wallet: {
            type: 'string',
            description: 'Solana wallet public key',
          },
          signature: {
            type: 'string',
            description: 'Signed nonce (base58 encoded)',
          },
          nonce: {
            type: 'string',
            description: 'The nonce that was signed',
          },
        },
        required: ['wallet', 'signature', 'nonce'],
      },
      LoginResponse: {
        type: 'object',
        properties: {
          accessToken: {
            type: 'string',
            description: 'JWT access token',
          },
          refreshToken: {
            type: 'string',
            description: 'JWT refresh token',
          },
          expiresIn: {
            type: 'integer',
            description: 'Token expiration in seconds',
          },
          wallet: {
            type: 'string',
            description: 'Authenticated wallet address',
          },
        },
        required: ['accessToken', 'refreshToken', 'expiresIn', 'wallet'],
      },
      SwapQuote: {
        type: 'object',
        properties: {
          quoteId: {
            type: 'string',
            description: 'Unique quote identifier',
          },
          inputMint: {
            type: 'string',
            description: 'Input token mint address',
          },
          outputMint: {
            type: 'string',
            description: 'Output token mint address',
          },
          inputAmount: {
            type: 'string',
            description: 'Input amount in smallest unit',
          },
          outputAmount: {
            type: 'string',
            description: 'Expected output amount',
          },
          otherAmountThreshold: {
            type: 'string',
            description: 'Minimum output amount after slippage',
          },
          slippageBps: {
            type: 'integer',
            description: 'Slippage in basis points',
          },
          priceImpactPct: {
            type: 'number',
            description: 'Price impact percentage',
          },
          route: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                marketId: { type: 'string' },
                label: { type: 'string' },
                inputMint: { type: 'string' },
                outputMint: { type: 'string' },
                inAmount: { type: 'string' },
                outAmount: { type: 'string' },
              },
            },
          },
          expiresAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      SwapExecuteRequest: {
        type: 'object',
        properties: {
          quoteId: {
            type: 'string',
            description: 'Quote ID from /api/swap/quote',
          },
          userPublicKey: {
            type: 'string',
            description: 'User wallet public key',
          },
          wrapUnwrapSOL: {
            type: 'boolean',
            default: true,
          },
          useProtectedMode: {
            type: 'boolean',
            default: false,
            description: 'Enable MEV protection',
          },
        },
        required: ['quoteId', 'userPublicKey'],
      },
      SwapExecuteResponse: {
        type: 'object',
        properties: {
          transactionId: {
            type: 'string',
            description: 'Internal transaction ID',
          },
          signature: {
            type: 'string',
            description: 'Solana transaction signature',
          },
          status: {
            type: 'string',
            enum: ['pending', 'confirmed', 'failed'],
          },
          inputAmount: {
            type: 'string',
          },
          outputAmount: {
            type: 'string',
          },
          explorerUrl: {
            type: 'string',
            format: 'uri',
          },
        },
      },
      SwapHistoryResponse: {
        type: 'object',
        properties: {
          swaps: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/SwapRecord',
            },
          },
          total: {
            type: 'integer',
          },
          hasMore: {
            type: 'boolean',
          },
        },
      },
      SwapRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          signature: { type: 'string' },
          inputMint: { type: 'string' },
          outputMint: { type: 'string' },
          inputAmount: { type: 'string' },
          outputAmount: { type: 'string' },
          status: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreatePaymentRequest: {
        type: 'object',
        properties: {
          amount: {
            type: 'string',
            description: 'Payment amount in smallest unit',
          },
          tokenMint: {
            type: 'string',
            description: 'Desired payment token mint',
          },
          description: {
            type: 'string',
            maxLength: 256,
          },
          expiresIn: {
            type: 'integer',
            description: 'Expiration in seconds',
            default: 3600,
          },
          metadata: {
            type: 'object',
            description: 'Custom metadata',
          },
        },
        required: ['amount', 'tokenMint'],
      },
      PaymentRequest: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          amount: { type: 'string' },
          tokenMint: { type: 'string' },
          recipient: { type: 'string' },
          description: { type: 'string' },
          status: {
            type: 'string',
            enum: ['pending', 'completed', 'expired', 'cancelled'],
          },
          expiresAt: {
            type: 'string',
            format: 'date-time',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
          paymentUrl: {
            type: 'string',
            format: 'uri',
          },
        },
      },
      PayWithTokenRequest: {
        type: 'object',
        properties: {
          payerWallet: {
            type: 'string',
            description: 'Payer wallet public key',
          },
          paymentTokenMint: {
            type: 'string',
            description: 'Token to pay with (any SPL token)',
          },
          slippageBps: {
            type: 'integer',
            default: 100,
          },
        },
        required: ['payerWallet', 'paymentTokenMint'],
      },
      PaymentResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          signature: { type: 'string' },
          paymentId: { type: 'string' },
          amountPaid: { type: 'string' },
          tokenUsed: { type: 'string' },
          swapExecuted: { type: 'boolean' },
        },
      },
      AnalyticsOverview: {
        type: 'object',
        properties: {
          totalVolume24h: { type: 'string' },
          totalSwaps24h: { type: 'integer' },
          totalPayments24h: { type: 'integer' },
          activeUsers24h: { type: 'integer' },
          averageSwapSize: { type: 'string' },
          topTokens: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                mint: { type: 'string' },
                symbol: { type: 'string' },
                volume: { type: 'string' },
                swapCount: { type: 'integer' },
              },
            },
          },
        },
      },
      VolumeAnalytics: {
        type: 'object',
        properties: {
          period: { type: 'string' },
          granularity: { type: 'string' },
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                timestamp: { type: 'string', format: 'date-time' },
                volume: { type: 'string' },
                swapCount: { type: 'integer' },
              },
            },
          },
        },
      },
      UserAnalytics: {
        type: 'object',
        properties: {
          totalSwaps: { type: 'integer' },
          totalVolume: { type: 'string' },
          totalPaymentsSent: { type: 'integer' },
          totalPaymentsReceived: { type: 'integer' },
          favoriteTokens: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                mint: { type: 'string' },
                symbol: { type: 'string' },
                usageCount: { type: 'integer' },
              },
            },
          },
          recentActivity: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['swap', 'payment'] },
                timestamp: { type: 'string', format: 'date-time' },
                details: { type: 'object' },
              },
            },
          },
        },
      },
      NotificationList: {
        type: 'object',
        properties: {
          notifications: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/Notification',
            },
          },
          unreadCount: { type: 'integer' },
          total: { type: 'integer' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: {
            type: 'string',
            enum: ['swap_completed', 'payment_received', 'payment_sent', 'system'],
          },
          title: { type: 'string' },
          message: { type: 'string' },
          read: { type: 'boolean' },
          data: { type: 'object' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      NotificationPreferences: {
        type: 'object',
        properties: {
          email: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              address: { type: 'string', format: 'email' },
              swapCompleted: { type: 'boolean' },
              paymentReceived: { type: 'boolean' },
              paymentSent: { type: 'boolean' },
              weeklyReport: { type: 'boolean' },
            },
          },
          push: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              swapCompleted: { type: 'boolean' },
              paymentReceived: { type: 'boolean' },
            },
          },
        },
      },
      UserProfile: {
        type: 'object',
        properties: {
          wallet: { type: 'string' },
          displayName: { type: 'string' },
          email: { type: 'string', format: 'email' },
          createdAt: { type: 'string', format: 'date-time' },
          settings: {
            type: 'object',
            properties: {
              defaultSlippageBps: { type: 'integer' },
              protectedModeEnabled: { type: 'boolean' },
              preferredExplorer: { type: 'string' },
            },
          },
        },
      },
      UpdateProfileRequest: {
        type: 'object',
        properties: {
          displayName: { type: 'string', maxLength: 50 },
          email: { type: 'string', format: 'email' },
          settings: {
            type: 'object',
            properties: {
              defaultSlippageBps: { type: 'integer', minimum: 0, maximum: 5000 },
              protectedModeEnabled: { type: 'boolean' },
              preferredExplorer: {
                type: 'string',
                enum: ['solscan', 'solana-explorer', 'solana-fm'],
              },
            },
          },
        },
      },
      // Risk Assessment schemas
      RiskAssessment: {
        type: 'object',
        description: 'Risk assessment for a swap quote using traffic light system',
        properties: {
          overallSignal: {
            type: 'string',
            enum: ['green', 'yellow', 'red'],
            description: 'Overall risk signal: green (safe), yellow (caution), red (high risk)',
          },
          canProceed: {
            type: 'boolean',
            description: 'Whether the swap can proceed based on risk assessment',
          },
          requiresAcknowledgement: {
            type: 'boolean',
            description: 'Whether user must acknowledge risks before proceeding',
          },
          reasons: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/RiskReason',
            },
          },
          scores: {
            type: 'object',
            properties: {
              priceImpact: { type: 'string', enum: ['green', 'yellow', 'red'] },
              slippage: { type: 'string', enum: ['green', 'yellow', 'red'] },
              liquidity: { type: 'string', enum: ['green', 'yellow', 'red'] },
              routeComplexity: { type: 'string', enum: ['green', 'yellow', 'red'] },
            },
          },
        },
        example: {
          overallSignal: 'yellow',
          canProceed: true,
          requiresAcknowledgement: true,
          reasons: [
            {
              factor: 'priceImpact',
              signal: 'yellow',
              message: 'Price impact of 1.5% is moderate',
              value: 1.5,
              threshold: 1,
            },
          ],
        },
      },
      RiskReason: {
        type: 'object',
        properties: {
          factor: {
            type: 'string',
            enum: ['priceImpact', 'slippage', 'liquidity', 'routeComplexity', 'amount'],
          },
          signal: { type: 'string', enum: ['green', 'yellow', 'red'] },
          message: { type: 'string' },
          value: { type: 'number' },
          threshold: { type: 'number' },
        },
      },
      // Enhanced Receipt schemas
      EnhancedReceipt: {
        type: 'object',
        description: 'Detailed execution receipt with all transaction data',
        properties: {
          id: { type: 'string', format: 'uuid' },
          signature: { type: 'string', description: 'Solana transaction signature' },
          inputMint: { type: 'string' },
          outputMint: { type: 'string' },
          inputAmount: { type: 'string' },
          outputAmount: { type: 'string' },
          fees: {
            $ref: '#/components/schemas/TransactionFees',
          },
          riskAssessment: {
            $ref: '#/components/schemas/RiskAssessment',
          },
          executionTimeMs: { type: 'integer' },
          status: { type: 'string', enum: ['pending', 'confirmed', 'failed'] },
          confirmations: { type: 'integer' },
          slot: { type: 'integer' },
          blockTime: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
        example: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          signature: '5wHu1qwD7...',
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          inputAmount: '1000000000',
          outputAmount: '100000000',
          executionTimeMs: 2500,
          status: 'confirmed',
        },
      },
      TransactionFees: {
        type: 'object',
        properties: {
          networkFee: { type: 'integer', description: 'Base network fee in lamports' },
          priorityFee: { type: 'integer', description: 'Priority fee in lamports' },
          jupiterFee: { type: 'integer', description: 'Jupiter platform fee in lamports' },
          totalFee: { type: 'integer' },
        },
      },
      // Intent schemas
      Intent: {
        type: 'object',
        description: 'A scheduled trading intent (DCA or Stop-Loss)',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string' },
          type: { type: 'string', enum: ['dca', 'stop_loss', 'limit_order'] },
          status: {
            type: 'string',
            enum: ['active', 'paused', 'completed', 'cancelled', 'failed'],
          },
          inputMint: { type: 'string' },
          outputMint: { type: 'string' },
          totalAmount: { type: 'string' },
          remainingAmount: { type: 'string' },
          // DCA specific
          sliceCount: { type: 'integer' },
          completedSlices: { type: 'integer' },
          intervalSeconds: { type: 'integer' },
          // Stop-Loss specific
          priceFeedId: { type: 'string', description: 'Pyth price feed ID' },
          priceThreshold: { type: 'number' },
          priceDirection: { type: 'string', enum: ['above', 'below'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          nextExecutionAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateDCARequest: {
        type: 'object',
        required: ['inputMint', 'outputMint', 'totalAmount', 'sliceCount', 'intervalSeconds'],
        properties: {
          inputMint: { type: 'string' },
          outputMint: { type: 'string' },
          totalAmount: { type: 'string' },
          sliceCount: { type: 'integer', minimum: 2, maximum: 100 },
          intervalSeconds: { type: 'integer', minimum: 60, maximum: 2592000 },
          slippageBps: { type: 'integer', minimum: 0, maximum: 5000, default: 50 },
        },
      },
      CreateStopLossRequest: {
        type: 'object',
        required: [
          'inputMint',
          'outputMint',
          'amount',
          'priceFeedId',
          'priceThreshold',
          'priceDirection',
        ],
        properties: {
          inputMint: { type: 'string' },
          outputMint: { type: 'string' },
          amount: { type: 'string' },
          priceFeedId: { type: 'string', description: 'Pyth price feed ID for monitoring' },
          priceThreshold: { type: 'number', description: 'Trigger price in USD' },
          priceDirection: { type: 'string', enum: ['above', 'below'] },
          slippageBps: { type: 'integer', default: 100 },
        },
      },
      // Oracle schemas
      OraclePrice: {
        type: 'object',
        description: 'Price data from Pyth oracle',
        properties: {
          feedId: { type: 'string' },
          price: { type: 'number' },
          confidence: { type: 'number' },
          confidencePct: { type: 'number' },
          publishTime: { type: 'integer' },
          ageSeconds: { type: 'integer' },
          isStale: { type: 'boolean' },
          hasLowConfidence: { type: 'boolean' },
        },
        example: {
          feedId: 'ef0d8b6f...',
          price: 150.25,
          confidence: 0.15,
          confidencePct: 0.1,
          publishTime: 1705312200,
          ageSeconds: 5,
          isStale: false,
          hasLowConfidence: false,
        },
      },
      StopLossTriggerCheck: {
        type: 'object',
        properties: {
          canExecute: { type: 'boolean' },
          triggered: { type: 'boolean' },
          reason: { type: 'string' },
          price: {
            $ref: '#/components/schemas/OraclePrice',
          },
        },
      },
      // Job Lock schemas (for admin/debug)
      JobLock: {
        type: 'object',
        description: 'Job lock for idempotent intent execution',
        properties: {
          jobId: { type: 'string' },
          intentId: { type: 'string' },
          windowStart: { type: 'integer' },
          status: { type: 'string', enum: ['processing', 'completed', 'failed'] },
          createdAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time' },
          txSignature: { type: 'string' },
        },
      },
    },
  },
};

export default openApiSpec;
