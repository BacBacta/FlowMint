/**
 * Swagger UI Setup for FlowMint API
 *
 * This module configures Swagger UI Express to serve interactive API documentation.
 */

import { Router, Request, Response } from 'express';
import type { Router as ExpressRouter } from 'express';
import swaggerUi from 'swagger-ui-express';

import { openApiSpec } from './openapi.js';

const router: ExpressRouter = Router();

// Swagger UI options
const swaggerUiOptions: swaggerUi.SwaggerUiOptions = {
  customCss: `
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info .title { color: #6366f1; }
    .swagger-ui .btn.authorize { 
      background-color: #6366f1; 
      border-color: #6366f1; 
    }
    .swagger-ui .btn.authorize:hover {
      background-color: #4f46e5;
    }
    .swagger-ui .opblock.opblock-get .opblock-summary-method { background: #22c55e; }
    .swagger-ui .opblock.opblock-post .opblock-summary-method { background: #3b82f6; }
    .swagger-ui .opblock.opblock-put .opblock-summary-method { background: #f59e0b; }
    .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #ef4444; }
  `,
  customSiteTitle: 'FlowMint API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    tryItOutEnabled: true,
    requestSnippetsEnabled: true,
    defaultModelsExpandDepth: 2,
    defaultModelExpandDepth: 2,
    docExpansion: 'list',
    syntaxHighlight: {
      activate: true,
      theme: 'monokai',
    },
  },
};

// Serve Swagger UI at /docs
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(openApiSpec, swaggerUiOptions));

// Serve OpenAPI spec as JSON
router.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// Serve OpenAPI spec as YAML
router.get('/openapi.yaml', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/yaml');
  const yaml = jsonToYaml(openApiSpec);
  res.send(yaml);
});

/**
 * Simple JSON to YAML converter for OpenAPI spec
 */
function jsonToYaml(obj: any, indent = 0): string {
  const spaces = '  '.repeat(indent);
  let result = '';

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === 'object' && item !== null) {
        result += `${spaces}-\n${jsonToYaml(item, indent + 1).replace(/^/, '')}`;
      } else {
        result += `${spaces}- ${formatValue(item)}\n`;
      }
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value) && value.length === 0) {
          result += `${spaces}${key}: []\n`;
        } else if (Object.keys(value).length === 0) {
          result += `${spaces}${key}: {}\n`;
        } else {
          result += `${spaces}${key}:\n${jsonToYaml(value, indent + 1)}`;
        }
      } else {
        result += `${spaces}${key}: ${formatValue(value)}\n`;
      }
    }
  }

  return result;
}

function formatValue(value: any): string {
  if (typeof value === 'string') {
    // Check if string needs quoting
    if (
      value.includes(':') ||
      value.includes('#') ||
      value.includes('\n') ||
      value.includes("'") ||
      value.includes('"') ||
      value === '' ||
      value === 'true' ||
      value === 'false' ||
      value === 'null' ||
      !isNaN(Number(value))
    ) {
      return `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return value;
  }
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export default router;
