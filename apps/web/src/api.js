// Where the API lives. Empty in development (Vite forwards /api to the local server); in production
// VITE_API_URL is the API service's address, e.g. https://api.example.com.
const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export const apiUrl = (path) => `${BASE}${path}`;
