import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { billitAdapter, resetBillitAuthCache } from 'src/apadapters/billit.js';
import { orderToInvoiceXml } from 'src/peppol/convert.js';

const sandboxFlag = (process.env.BILLIT_SANDBOX ?? '').trim().toLowerCase() === 'true';
const hasBaseUrl = (process.env.AP_BASE_URL ?? '').trim().length > 0;
const hasRegistration = ['AP_REGISTRATION_ID', 'BILLIT_REGISTRATION_ID', 'AP_PARTY_ID']
  .some((key) => (process.env[key] ?? '').trim().length > 0);
const hasApiKey = (process.env.AP_API_KEY ?? '').trim().length > 0;
const hasOauthSecrets = ['BILLIT_CLIENT_ID', 'BILLIT_CLIENT_SECRET', 'BILLIT_REDIRECT_URI']
  .every((key) => (process.env[key] ?? '').trim().length > 0);
const hasRequiredSecrets = hasBaseUrl && hasRegistration && (hasApiKey || hasOauthSecrets);

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

  const resolveRegistrationId = (): string => {
    const candidates = [
      (process.env.AP_REGISTRATION_ID ?? '').trim(),
      (process.env.BILLIT_REGISTRATION_ID ?? '').trim(),
      (process.env.AP_PARTY_ID ?? '').trim()
    ];
    const registration = candidates.find((value) => value.length > 0);
    if (!registration) {
      throw new Error('Missing required Billit sandbox env: AP_REGISTRATION_ID (or BILLIT_REGISTRATION_ID/AP_PARTY_ID)');
    }
    return registration;
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
      captureEnv('AP_REGISTRATION_ID', resolveRegistrationId());
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
          JSON.stringify({ OrderID: 'billit-123', status: 'received', message: 'accepted' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      const result = await billitAdapter.send({
        tenant: 'sandbox',
        invoiceId: order.orderNumber,
        ublXml,
        order
      });

      expect(result.providerId).toBe('billit-123');
      expect(result.status).toBe('queued');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const baseUrl = requireTrimmed('AP_BASE_URL').replace(/\/+$/, '').replace(/\/api\/?$/i, '');
      expect(requestUrl.startsWith(baseUrl)).toBe(true);
      const url = new URL(requestUrl);
      expect(url.pathname).toMatch(/\/v1\/(commands\/send|einvoices\/registrations\/[^/]+\/commands\/send)/);
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.ApiKey ?? headers?.Authorization).toMatch(/.+/);
      expect(headers?.['Content-Type'] ?? headers?.['content-type']).toBe('application/json');
      expect(headers?.Accept ?? headers?.accept).toBe('application/json');
      const body = init?.body as string | undefined;
      expect(body).toBeDefined();
      if (body) {
        const payload = JSON.parse(body) as Record<string, unknown>;
        const registrationId = resolveRegistrationId();
        expect(payload.registrationId).toBe(registrationId);
        expect(payload.transportType).toBeDefined();
        const documents = payload.documents as unknown[];
        expect(Array.isArray(documents)).toBe(true);
        const [document] = documents ?? [];
        const docRecord = document as Record<string, unknown>;
        expect(docRecord?.invoiceNumber).toBe(order.orderNumber);
        expect(Array.isArray(docRecord?.lines)).toBe(true);
      }
    });
  });
}
