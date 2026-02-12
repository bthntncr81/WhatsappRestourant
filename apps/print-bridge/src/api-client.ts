import { config } from './config';

export interface PrintJobPayload {
  orderNumber: number;
  timestamp: string;
  items: {
    name: string;
    qty: number;
    options: string[];
    notes: string | null;
  }[];
  notes: string | null;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  paymentMethod?: string;
  totalPrice?: number;
}

export interface PrintJob {
  id: string;
  tenantId: string;
  orderId: string;
  type: 'KITCHEN' | 'COURIER';
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  payloadJson: PrintJobPayload;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  processedAt: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export class ApiClient {
  private baseUrl: string;
  private tenantId: string;
  private token: string;

  constructor() {
    this.baseUrl = config.apiUrl;
    this.tenantId = config.tenantId;
    this.token = config.apiToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: object
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`,
      'x-tenant-id': this.tenantId,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API Error ${response.status}: ${errorBody}`);
    }

    const data: ApiResponse<T> = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || data.message || 'Unknown API error');
    }

    return data.data as T;
  }

  async getPendingJobs(limit = 10): Promise<PrintJob[]> {
    return this.request<PrintJob[]>('GET', `/print-jobs/pending?limit=${limit}`);
  }

  async claimJob(jobId: string): Promise<PrintJob> {
    return this.request<PrintJob>('POST', `/print-jobs/${jobId}/claim`);
  }

  async completeJob(
    jobId: string,
    success: boolean,
    errorMessage?: string
  ): Promise<PrintJob> {
    return this.request<PrintJob>('POST', `/print-jobs/${jobId}/complete`, {
      success,
      errorMessage,
    });
  }
}

export const apiClient = new ApiClient();


