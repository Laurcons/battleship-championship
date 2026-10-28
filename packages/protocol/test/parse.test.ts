import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_INBOUND_FRAME_BYTES, parseInbound, utf8Length } from '../src/index.js';

const hello = {
  type: 'hello',
  token: 'bsc_x',
  lobby: 'K7QM-4XD2-7',
  accepts: ['classic-10x10'],
};

describe('parseInbound', () => {
  it('accepts the three inbound frames, ignoring unknown fields', () => {
    expect(parseInbound(JSON.stringify({ ...hello, extra: 1 }))).toMatchObject({ ok: true, frame: { type: 'hello' } });
    expect(parseInbound('{"type":"fire","rid":7,"x":3,"y":4}')).toMatchObject({ ok: true, frame: { x: 3, y: 4 } });
    const placement = { type: 'placement', rid: 1, ships: [{ len: 5, x: 0, y: 0, dir: 'h' }] };
    expect(parseInbound(JSON.stringify(placement))).toMatchObject({ ok: true });
  });

  it('classifies bad JSON, non-objects and unknown types', () => {
    expect(parseInbound('{nope')).toMatchObject({ ok: false, code: 'bad_json' });
    expect(parseInbound('[1,2]')).toMatchObject({ ok: false, code: 'bad_json' });
    expect(parseInbound('null')).toMatchObject({ ok: false, code: 'bad_json' });
    expect(parseInbound('{"rid":1}')).toMatchObject({ ok: false, code: 'unknown_type' });
    expect(parseInbound('{"type":"turn","rid":1}')).toMatchObject({ ok: false, code: 'unknown_type' });
    expect(parseInbound('{"type":"__proto__"}')).toMatchObject({ ok: false, code: 'unknown_type' });
  });

  it('reports the rid of a wrongly shaped reply so a strike can be attributed', () => {
    const result = parseInbound('{"type":"fire","rid":9,"x":"3","y":4}');
    expect(result).toMatchObject({ ok: false, code: 'bad_shape', rid: 9, type: 'fire' });
    expect(parseInbound('{"type":"fire","rid":1.5,"x":3,"y":4}')).toMatchObject({ ok: false, code: 'bad_shape' });
    expect(parseInbound('{"type":"fire","rid":-1,"x":3,"y":4}')).toMatchObject({ ok: false, code: 'bad_shape' });
    expect(parseInbound('{"type":"fire","rid":1,"x":3.5,"y":4}')).toMatchObject({ ok: false, code: 'bad_shape' });
    expect(parseInbound('{"type":"fire","rid":1,"x":null,"y":4}')).toMatchObject({ ok: false, code: 'bad_shape' });
  });

  it('rejects malformed placements and hellos', () => {
    expect(parseInbound('{"type":"placement","rid":1,"ships":[{"len":5,"x":0,"y":0,"dir":"up"}]}')).toMatchObject({ ok: false });
    expect(parseInbound('{"type":"placement","rid":1}')).toMatchObject({ ok: false });
    expect(parseInbound(JSON.stringify({ ...hello, accepts: [] }))).toMatchObject({ ok: false });
    expect(parseInbound(JSON.stringify({ ...hello, token: 5 }))).toMatchObject({ ok: false });
    expect(parseInbound(JSON.stringify({ ...hello, program: { name: '' } }))).toMatchObject({ ok: false });
  });

  it('enforces the frame size limit in bytes, not characters', () => {
    const big = JSON.stringify({ ...hello, token: 'x'.repeat(MAX_INBOUND_FRAME_BYTES) });
    expect(parseInbound(big)).toMatchObject({ ok: false, code: 'frame_too_large' });
    const multibyte = 'é'.repeat(MAX_INBOUND_FRAME_BYTES / 2); // fewer characters than the limit, more bytes
    expect(parseInbound(`{"type":"hello","token":"${multibyte}"}`)).toMatchObject({ ok: false, code: 'frame_too_large' });
  });

  it('never throws, whatever the input', () => {
    fc.assert(fc.property(fc.string(), (text) => void parseInbound(text)));
    fc.assert(fc.property(fc.json(), (text) => void parseInbound(text)));
    fc.assert(fc.property(fc.object({ maxDepth: 3 }), (value) => void parseInbound(JSON.stringify(value))));
  });

  it('measures UTF-8 length exactly', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary' }), (s) => utf8Length(s) === new TextEncoder().encode(s).length));
  });
});
