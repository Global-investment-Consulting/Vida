import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { billitAdapter, resetBillitAuthCache } from 'src/apadapters/billit.js';
import { orderToInvoiceXml } from 'src/peppol/convert.js';

const sandboxFlag = (process.env.BILLIT_SANDBOX ?? '').trim().toLowerCase() === 'true';
const hasRequiredSecrets = ['BILLIT_CLIENT_ID', 'BILLIT_CLIENT_SECRET', 'BILLIT_REDIRECT_URI', 'AP_BASE_URL']
  .every((key) => (process.env[key] ?? '').trim().length > 0);

if (!sandboxFlag || !hasRequiredSecrets) {
  describe.skip('billit sandbox contract', () => {
    it('requires BILLIT_SANDBOX=true plus Billit sandbox secrets to run', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const fileUrl = fileURLToPath(import.meta.url);
  const dirName = path.dirname(fileUrl);
  const fixturePath = path.join(dirName, '..', 'fixtures', 'billit_invoice_minimal.json');
  const restoreEnv: Record<string, string | undefined> = {};

  const captureEnv = (key: string, value: string): void => {
    if (!(key in restoreEnv)) {
      restoreEnv[key] = process.env[key];
    }
    process.env[key] = value;
  };

  const requireTrimmed = (key: string): string => {
    const value = (process.env[key] ?? '').trim();
    if (!value) {
      throw new Error('Missing required Billit sandbox env: ' + key);
    }
    return value;
  };

  describe('billit sandbox contract', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      resetBillitAuthCache();
      vi.restoreAllMocks();
      const baseUrl = requireTrimmed('AP_BASE_URL');
      captureEnv('AP_BASE_URL', baseUrl);
      captureEnv('AP_CLIENT_ID', requireTrimmed('BILLIT_CLIENT_ID'));
      captureEnv('AP_CLIENT_SECRET', requireTrimmed('BILLIT_CLIENT_SECRET'));
      captureEnv('AP_API_KEY', (process.env.AP_API_KEY ?? 'sandbox-placeholder-key').trim() || 'sandbox-placeholder-key');
    });

    afterAll(() => {
      resetBillitAuthCache();
      vi.restoreAllMocks();
      Object.entries(restoreEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      if (originalFetch) {
        globalThis.fetch = originalFetch;
      }
    });

    it('posts UBL XML to the expected Billit endpoint with contract headers', async () => {
      const order = JSON.parse(readFileSync(fixturePath, 'utf8'));
      const ublXml = await orderToInvoiceXml(order);

      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({ providerId: 'billit-123', status: 'received', message: 'accepted' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      const result = await billitAdapter.send({ tenant: 'sandbox', invoiceId: order.orderNumber, ublXml });

      expect(result.providerId).toBe('billit-123');
      expect(result.status).toBe('queued');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const normalizedBase = (process.env.AP_BASE_URL ?? '').replace(/\/+$/, '');
      expect(requestUrl).toBe(normalizedBase + '/api/invoices');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        Authorization: expect.stringMatching(/^(Bearer|ApiKey)\s.+/),
        'Content-Type': 'application/xml',
        Accept: 'application/json'
      });
      expect(init?.body).toBe(ublXml);
    });
  });
}
