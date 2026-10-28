import { useState } from 'react';
import { Button } from 'react-bootstrap';

export function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'lg' }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline-secondary"
      size={size}
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={`${label} ${copied ? '(copied)' : ''}`.trim()}
    >
      <i className={`bi bi-${copied ? 'check2' : 'clipboard'} me-1`} aria-hidden="true" />
      {copied ? 'Copied' : label}
    </Button>
  );
}
