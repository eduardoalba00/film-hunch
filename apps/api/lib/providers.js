// Errors from Jev or OpenAI that waiting won't fix: the account is out of credit or the key was
// rejected. The API pauses search sitewide when it sees one (see lib/guard.js).

export class ProviderError extends Error {
  // provider: "jev" | "openai"; kind: "credits" | "auth"
  constructor(provider, kind, message) {
    super(message);
    this.provider = provider;
    this.kind = kind;
  }
}

const BILLING = /credit|balance|quota|insufficient|billing|payment|exceeded your/i;

// Jev: 402 or a billing message means out of credit; 401/403 means the key was rejected.
export function jevError(status, body) {
  if (status === 402 || (status === 429 && BILLING.test(body)) || (status === 403 && BILLING.test(body))) {
    return new ProviderError("jev", "credits", `Jev is out of credit (${status}): ${body.slice(0, 200)}`);
  }
  if (status === 401 || status === 403) return new ProviderError("jev", "auth", `Jev rejected the API key (${status})`);
  return null;
}

// OpenAI: 429 with code insufficient_quota means out of credit (not a rate limit); 401 a bad key.
export function openaiError(status, body) {
  if (status === 429 && /insufficient_quota|billing/i.test(body)) {
    return new ProviderError("openai", "credits", "OpenAI is out of credit (insufficient_quota)");
  }
  if (status === 401) return new ProviderError("openai", "auth", "OpenAI rejected the API key (401)");
  return null;
}
