import axios from 'axios';

export const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_URL ||
    'https://vida-staging-731655778429.europe-west1.run.app',
});
