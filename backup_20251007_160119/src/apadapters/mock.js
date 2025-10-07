export async function sendToPeppol({ xml, receiverId }) {
  // Simulate network delay
  await new Promise(r => setTimeout(r, 150));
  return { success: true, transmissionId: 'AP-' + Math.random().toString(36).slice(2,10), receiverId };
}
