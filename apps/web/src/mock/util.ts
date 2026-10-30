/** A fresh account token: 32 random characters after the `bsc_` prefix. */
export function newToken(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `bsc_${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

const HOME_ADDRESSES: Record<string, string> = {
  p_alice: '84.12.5.20',
  p_bruno: '91.77.3.9',
  p_chen: '77.30.8.4',
  p_dana: '85.120.4.77',
};

const hashOf = (text: string): number => {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};

/** The address a simulated participant normally connects from. */
export function homeAddress(participantId: string): string {
  const known = HOME_ADDRESSES[participantId];
  if (known) return known;
  const h = hashOf(participantId);
  return `86.${(h % 200) + 10}.${((h >> 8) % 250) + 1}.${((h >> 16) % 250) + 1}`;
}

/** Another address of the same participant, for simulating a token used from somewhere else (documentation range). */
export function otherAddress(participantId: string): string {
  return `203.0.113.${(hashOf(participantId) % 200) + 10}`;
}
