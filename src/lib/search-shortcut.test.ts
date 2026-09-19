import { describe, expect, it } from 'vitest';
import { shouldOpenSearch } from './search-shortcut.js';

describe('search shortcut', () => {
  it('opens search for a plain slash key', () => {
    expect(shouldOpenSearch({ key: '/', targetTag: 'BODY' })).toBe(true);
  });

  it('does not steal typing from form controls', () => {
    for (const targetTag of ['input', 'textarea', 'select']) {
      expect(shouldOpenSearch({ key: '/', targetTag })).toBe(false);
    }
  });

  it('does not steal typing from contenteditable regions', () => {
    expect(shouldOpenSearch({ key: '/', targetTag: 'DIV', targetEditable: true })).toBe(false);
  });

  it('leaves browser and operating-system modifier shortcuts alone', () => {
    expect(shouldOpenSearch({ key: '/', ctrlKey: true })).toBe(false);
    expect(shouldOpenSearch({ key: '/', metaKey: true })).toBe(false);
    expect(shouldOpenSearch({ key: '/', altKey: true })).toBe(false);
  });
});
