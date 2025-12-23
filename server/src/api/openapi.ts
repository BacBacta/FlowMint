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
        description: 'Get the authenticated user\'s swap history',
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
        description: 'Get the user\'s notification preferences',
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
        description: 'Update the user\'s notification preferences',
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
        description: 'Get the authenticated user\'s profile',
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
        description: 'Update the authenticated user\'s profile',
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
    },
  },
};

export default openApiSpec;
