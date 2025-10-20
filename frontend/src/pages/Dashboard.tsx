import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function Dashboard() {
  const [health, setHealth] = useState('Checking...');

  useEffect(() => {
    api
      .get('/_health')
      .then(() => setHealth('✅ API Healthy'))
      .catch(() => setHealth('❌ Offline'));
  }, []);

  return (
    <main style={{ padding: 32 }}>
      <h1>ViDA Operational MVP</h1>
      <p>Status: {health}</p>
    </main>
  );
}
