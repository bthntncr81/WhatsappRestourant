import puppeteer, { Browser } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { PrintJob, PrintJobPayload } from './api-client';
import { config } from './config';

export class ReceiptGenerator {
  private browser: Browser | null = null;
  private kitchenTemplate: string;
  private courierTemplate: string;

  constructor() {
    const templatesDir = path.join(__dirname, '..', 'templates');
    this.kitchenTemplate = fs.readFileSync(
      path.join(templatesDir, 'kitchen.html'),
      'utf-8'
    );
    this.courierTemplate = fs.readFileSync(
      path.join(templatesDir, 'courier.html'),
      'utf-8'
    );
  }

  async init(): Promise<void> {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async generateReceipt(job: PrintJob): Promise<string> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const template = job.type === 'KITCHEN' ? this.kitchenTemplate : this.courierTemplate;
    const html = this.renderTemplate(template, job.payloadJson);

    const page = await this.browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Ensure output directory exists
      const outputDir = path.resolve(config.outputDir);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filename = `${job.type.toLowerCase()}_${job.payloadJson.orderNumber}_${Date.now()}.pdf`;
      const filepath = path.join(outputDir, filename);

      await page.pdf({
        path: filepath,
        width: '80mm',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });

      console.log(`✅ Receipt saved: ${filepath}`);
      return filepath;
    } finally {
      await page.close();
    }
  }

  private renderTemplate(template: string, payload: PrintJobPayload): string {
    let html = template;

    // Format timestamp
    const timestamp = new Date(payload.timestamp).toLocaleString('tr-TR');
    const printTime = new Date().toLocaleString('tr-TR');

    // Simple mustache-like replacements
    html = html.replace(/\{\{orderNumber\}\}/g, String(payload.orderNumber || 0));
    html = html.replace(/\{\{timestamp\}\}/g, timestamp);
    html = html.replace(/\{\{printTime\}\}/g, printTime);
    html = html.replace(/\{\{customerName\}\}/g, payload.customerName || 'Misafir');
    html = html.replace(/\{\{customerPhone\}\}/g, payload.customerPhone || '-');
    html = html.replace(/\{\{deliveryAddress\}\}/g, payload.deliveryAddress || '-');
    html = html.replace(/\{\{paymentMethod\}\}/g, this.formatPaymentMethod(payload.paymentMethod));
    html = html.replace(/\{\{totalPrice\}\}/g, payload.totalPrice?.toFixed(2) || '0.00');
    html = html.replace(/\{\{notes\}\}/g, payload.notes || '');

    // Handle items
    const itemsHtml = payload.items
      .map((item) => {
        const optionsHtml = item.options?.length
          ? `<div class="item-options">${item.options.map((o) => `→ ${o}<br>`).join('')}</div>`
          : '';
        const notesHtml = item.notes
          ? `<div class="item-notes">📝 ${item.notes}</div>`
          : '';

        return `
          <div class="item">
            <div class="item-header">
              <span class="item-qty">${item.qty}x</span>
              <span class="item-name">${item.name}</span>
            </div>
            ${optionsHtml}
            ${notesHtml}
          </div>
        `;
      })
      .join('');

    // Replace items section
    html = html.replace(
      /\{\{#items\}\}[\s\S]*?\{\{\/items\}\}/g,
      itemsHtml
    );

    // Handle conditional sections
    if (payload.notes) {
      html = html.replace(/\{\{#notes\}\}/g, '').replace(/\{\{\/notes\}\}/g, '');
    } else {
      html = html.replace(/\{\{#notes\}\}[\s\S]*?\{\{\/notes\}\}/g, '');
    }

    if (payload.deliveryAddress) {
      html = html.replace(/\{\{#deliveryAddress\}\}/g, '').replace(/\{\{\/deliveryAddress\}\}/g, '');
    } else {
      html = html.replace(/\{\{#deliveryAddress\}\}[\s\S]*?\{\{\/deliveryAddress\}\}/g, '');
    }

    // Handle options.length conditional (simplified)
    html = html.replace(/\{\{#options\.length\}\}[\s\S]*?\{\{\/options\.length\}\}/g, '');

    return html;
  }

  private formatPaymentMethod(method?: string): string {
    const methods: Record<string, string> = {
      CASH: 'NAKİT',
      CARD: 'KREDİ KARTI',
      ONLINE: 'ONLINE ÖDEME',
    };
    return methods[method || ''] || method || 'BELİRTİLMEDİ';
  }
}

export const receiptGenerator = new ReceiptGenerator();


