import { sendToPeppol as mockSend } from './mock.js';
// TODO: import real adapter when wired.

export function getAdapter() {
  const mode = (process.env.AP_MODE || 'mock').toLowerCase();
  if (mode === 'mock') return { name: 'mock', send: mockSend };
  // if (mode === 'real') return { name: 'real', send: realSend };
  return { name: 'mock', send: mockSend };
}
