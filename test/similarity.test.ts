import { describe, expect, it } from 'vitest';
import { normalizeForSimilarity, textSimilarity } from '../src/compare/similarity.js';

describe('textSimilarity', () => {
  it('is 1 for identical text after normalization (case/whitespace)', () => {
    expect(textSimilarity('Welcome Back', 'welcome back')).toBe(1);
    expect(textSimilarity('  Sign   In ', 'sign in')).toBe(1);
  });

  it('is high for reworded-but-close copy', () => {
    expect(textSimilarity('Create your account', 'Create an account')).toBeGreaterThan(0.6);
    expect(textSimilarity('Forgot Password?', 'Forgot password')).toBeGreaterThan(0.85);
  });

  it('is low for genuinely different copy', () => {
    expect(textSimilarity('Sign In', 'Login')).toBeLessThan(0.4);
    expect(textSimilarity("Let's Sniff Out Some Tail-Wagging Matches Today!", 'Sign in to manage adoptions')).toBeLessThan(0.3);
  });

  it('handles empty / very short strings without NaN', () => {
    expect(textSimilarity('', '')).toBe(1);
    expect(textSimilarity('a', 'b')).toBe(0);
    expect(Number.isNaN(textSimilarity('x', 'yz'))).toBe(false);
  });

  it('normalizeForSimilarity collapses case and whitespace', () => {
    expect(normalizeForSimilarity('  Hello   World ')).toBe('hello world');
  });
});
