import * as assert from 'assert';
import { newId, nowIso, getBodyClass, debounce } from '../src/util';

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

describe('debounce', () => {
  it('collapses rapid repeated calls into a single trailing call', (done) => {
    let calls = 0;
    const debounced = debounce(() => {
      calls++;
    }, 20);

    debounced();
    debounced();
    debounced();

    setTimeout(() => {
      assert.strictEqual(calls, 1);
      done();
    }, 60);
  });

  it('passes through the arguments of the last call', (done) => {
    const received: number[] = [];
    const debounced = debounce((n: number) => {
      received.push(n);
    }, 20);

    debounced(1);
    debounced(2);
    debounced(3);

    setTimeout(() => {
      assert.deepStrictEqual(received, [3]);
      done();
    }, 60);
  });

  it('runs again for calls made after the delay has elapsed', (done) => {
    let calls = 0;
    const debounced = debounce(() => {
      calls++;
    }, 20);

    debounced();

    setTimeout(() => {
      debounced();
    }, 40);

    setTimeout(() => {
      assert.strictEqual(calls, 2);
      done();
    }, 90);
  });
});
