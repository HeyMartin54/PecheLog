import { generateUuid, isUuid } from '@/lib/uuid';

describe('UUID client', () => {
  it('produit des UUID v4 valides et distincts', () => {
    const ids = Array.from({ length: 2000 }, () => generateUuid());
    expect(ids.every(isUuid)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id[14] === '4' && '89ab'.includes(id[19]))).toBe(true);
  });

  it('fonctionne sans API crypto (moteur JS minimal)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const id = generateUuid();
      expect(isUuid(id)).toBe(true);
      expect(id[14]).toBe('4');
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  it('rejette ce qui n\'est pas un UUID', () => {
    expect(isUuid('local_1700000000000')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
