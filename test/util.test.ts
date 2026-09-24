import * as assert from 'assert';
import { newId, nowIso, getBodyClass } from '../src/util';

describe('util', () => {
  it('newId returns a non-empty unique string', () => {
    const a = newId();
    const b = newId();
    assert.strictEqual(typeof a, 'string');
    assert.ok(a.length > 0);
    assert.notStrictEqual(a, b);
  });

  it('nowIso returns a valid ISO-8601 timestamp', () => {
    const iso = nowIso();
    assert.strictEqual(typeof iso, 'string');
    assert.ok(!isNaN(new Date(iso).getTime()));
    assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('getBodyClass returns "dev-mode" when running from the source tree', () => {
    assert.strictEqual(getBodyClass(true), 'dev-mode');
  });

  it('getBodyClass returns an empty string for a production/VSIX-installed build', () => {
    assert.strictEqual(getBodyClass(false), '');
  });
});
