import { describe, expect, it } from 'vitest';
import {
  isSafeExternalUrl,
  sanitizeExternalUrl,
} from '@/modules/part-search/domain/url-validation';

describe('isSafeExternalUrl (item 33, 119, 120, 168, 206 a 211)', () => {
  it('aceita https', () => {
    expect(isSafeExternalUrl('https://loja.exemplo.com/peca/123')).toBe(true);
  });

  it('aceita http', () => {
    expect(isSafeExternalUrl('http://loja.exemplo.com/peca/123')).toBe(true);
  });

  it('rejeita javascript:', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejeita data:', () => {
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejeita file:', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejeita string vazia', () => {
    expect(isSafeExternalUrl('')).toBe(false);
  });

  it('rejeita null/undefined', () => {
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
  });

  it('rejeita texto que nao e URL', () => {
    expect(isSafeExternalUrl('nao e uma url')).toBe(false);
  });
});

describe('sanitizeExternalUrl', () => {
  it('devolve a URL quando segura', () => {
    expect(sanitizeExternalUrl('https://loja.exemplo.com')).toBe('https://loja.exemplo.com');
  });

  it('devolve null quando insegura, nunca lanca', () => {
    expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull();
  });
});
