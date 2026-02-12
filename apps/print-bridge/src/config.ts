import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from print-bridge directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  apiUrl: process.env.API_URL || 'http://localhost:3000/api',
  tenantId: process.env.TENANT_ID || '',
  apiToken: process.env.API_TOKEN || '',
  pollInterval: parseInt(process.env.POLL_INTERVAL || '5000', 10),
  outputDir: process.env.OUTPUT_DIR || './printed',
};

export function validateConfig(): void {
  if (!config.tenantId) {
    throw new Error('TENANT_ID is required');
  }
  if (!config.apiToken) {
    throw new Error('API_TOKEN is required');
  }
}


