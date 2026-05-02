#!/usr/bin/env node
/**
 * Step 22e — RVF format hardening negative tests.
 *
 * Per ADR-093 §S6, the browser RVF deserializer must reject
 * malformed exports rather than partially-load them. This script
 * verifies five negative cases throw with descriptive errors plus
 * one happy-path roundtrip.
 *
 * Run: `npx tsx scripts/check-rvf-format.mjs`
 */

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✘ ${label}`, detail ?? ''); fail++; }
}

function expectThrow(label, fn, regex) {
  try {
    fn();
    check(label + ' (expected throw)', false, '— no error thrown');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const matched = regex.test(msg);
    check(label + ` (msg matches ${regex})`, matched, `— got: ${msg}`);
  }
}

const fmt = await import('../src/integrations/rvf/format.ts');

// ── Helper: craft a minimal RVF v1 buffer ────────────────────────
function craftRvf({
  magic = 'RVF\0',
  header = { magic: 'RVF\0', version: 1, dimensions: 384, metric: 'cosine', quantization: 'fp32', entryCount: 0, createdAt: 0, updatedAt: 0 },
  entries = [],
} = {}) {
  const enc = new TextEncoder();
  const headerJson = enc.encode(JSON.stringify(header));
  const entriesJson = enc.encode(JSON.stringify(entries));
  const total = 4 + 4 + headerJson.length + 4 + entriesJson.length;
  const out = new Uint8Array(total);
  for (let i = 0; i < 4; i++) out[i] = magic.charCodeAt(i) & 0xff;
  function writeU32LE(o, val) {
    out[o] = val & 0xff;
    out[o+1] = (val >>> 8) & 0xff;
    out[o+2] = (val >>> 16) & 0xff;
    out[o+3] = (val >>> 24) & 0xff;
  }
  let off = 4;
  writeU32LE(off, headerJson.length); off += 4;
  out.set(headerJson, off); off += headerJson.length;
  writeU32LE(off, entriesJson.length); off += 4;
  out.set(entriesJson, off);
  return out;
}

console.log('RVF format hardening — negative tests + happy path');
console.log('');

// 1. Bad magic
console.log('[1/6] Bad magic → throws');
expectThrow('bad magic',
  () => fmt.decodeRvf(craftRvf({ magic: 'XYZ\0' })),
  /bad magic/i);

// 2. Future version
console.log('[2/6] Future version → throws');
expectThrow('version > MAX',
  () => fmt.decodeRvf(craftRvf({ header: {
    magic: 'RVF\0', version: 99, dimensions: 384, metric: 'cosine',
    quantization: 'fp32', entryCount: 0, createdAt: 0, updatedAt: 0,
  } })),
  /version 99 not supported/i);

// 3. Truncated buffer (declared header length > actual)
console.log('[3/6] Truncated buffer → throws');
expectThrow('truncated header', () => {
  const enc = new TextEncoder();
  const fakeHeader = enc.encode('{"magic":"RVF\\u0000","version":1,"dimensions":384}');
  const buf = new Uint8Array(4 + 4 + fakeHeader.length); // missing entries section entirely
  buf[0]='R'.charCodeAt(0); buf[1]='V'.charCodeAt(0); buf[2]='F'.charCodeAt(0); buf[3]=0;
  // Set declared headerLen to 999_999 — way bigger than what's actually in the buffer
  buf[4]=0x7F; buf[5]=0x12; buf[6]=0x0F; buf[7]=0x00; // 0x000F127F = 988_799
  return fmt.decodeRvf(buf);
}, /truncated|implausible/i);

// 4. Per-entry size > 256KB
console.log('[4/6] Oversized entry > 256KB → throws');
expectThrow('per-entry cap', () => {
  // Build an entry whose serialized size exceeds the cap
  const big = 'x'.repeat(300 * 1024);
  return fmt.decodeRvf(craftRvf({
    entries: [{
      id: 'e1', key: 'k1', namespace: 'default',
      value: big,
      createdAt: 0, updatedAt: 0,
    }],
  }));
}, /MAX_ENTRY_SIZE_BYTES|exceeds/i);

// 5. Vector dim mismatch with header
console.log('[5/6] Vector dim ≠ header.dimensions → throws');
expectThrow('dim mismatch', () => {
  // Header says dim=384 but entry's vector base64 represents 100 floats
  // 100 floats × 4 bytes = 400 bytes raw, base64-encoded
  const wrong = new Float32Array(100);
  for (let i = 0; i < 100; i++) wrong[i] = i / 100;
  const bytes = new Uint8Array(wrong.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = Buffer.from(bin, 'binary').toString('base64');
  return fmt.decodeRvf(craftRvf({
    entries: [{
      id: 'e1', key: 'k1', namespace: 'default',
      value: 'short',
      vector: b64,
      createdAt: 0, updatedAt: 0,
    }],
  }));
}, /vector length 100 does not match header\.dimensions 384/i);

// 6. Happy path — encode then decode round-trips
console.log('[6/6] Happy path roundtrip');
{
  const v = new Float32Array(384);
  for (let i = 0; i < 384; i++) v[i] = i / 384;
  const file = {
    header: { magic: 'RVF\0', version: 1, dimensions: 384, metric: 'cosine',
              quantization: 'fp32', entryCount: 1, createdAt: 1, updatedAt: 2 },
    entries: [{ id: 'e1', key: 'k1', namespace: 'default', value: { hello: 'world' },
                vector: v, createdAt: 1, updatedAt: 2 }],
  };
  const buf = fmt.encodeRvf(file);
  const back = fmt.decodeRvf(buf);
  check('roundtrip preserves entry count', back.entries.length === 1);
  check('roundtrip preserves key', back.entries[0].key === 'k1');
  check('roundtrip preserves vector dim', back.entries[0].vector?.length === 384);
  check('roundtrip preserves vector value', back.entries[0].vector?.[100] === v[100]);
  check('roundtrip preserves header.dimensions', back.header.dimensions === 384);
}

console.log('');
console.log(`Passed: ${pass}  Failed: ${fail}`);
process.exit(fail);
