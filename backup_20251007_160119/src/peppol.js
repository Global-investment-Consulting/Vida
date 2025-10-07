export async function sendToPeppol({ xml, receiverId }) {
  await new Promise(r => setTimeout(r, 200));
  return { success: true, transmissionId: 'AP-' + Math.random().toString(36).slice(2, 10), receiverId };
}
