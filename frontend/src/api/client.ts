import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://vida-staging-mtsykhir3q-ew.a.run.app',
});
