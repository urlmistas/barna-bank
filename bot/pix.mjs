// PIX "copia e cola" (BR Code / EMV) e QR Code em SVG.
// QR: qrcode-generator (c) Kazuhiko Arase, licença MIT (bot/LICENSE-qrcode.txt).
import qrcode from './qrcode.mjs';

const ascii = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-@+_]/g, '').trim();
function field(id, value) { return id + String(value.length).padStart(2, '0') + value; }
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
// key já normalizada pelo app (+55..., CPF só números, e-mail, chave aleatória)
export function pixCode({key, name, city, amount, txid}) {
  if (!key) return '';
  const gui = field('00', 'br.gov.bcb.pix') + field('01', String(key).trim());
  let p = field('00', '01') + field('26', gui) + field('52', '0000') + field('53', '986');
  if (amount > 0) p += field('54', (Math.round(amount * 100) / 100).toFixed(2));
  p += field('58', 'BR') + field('59', (ascii(name) || 'BARNABANK').slice(0, 25)) + field('60', (ascii(city) || 'BRASIL').toUpperCase().slice(0, 15));
  p += field('62', field('05', (ascii(txid).replace(/[^A-Za-z0-9]/g, '') || '***').slice(0, 25)));
  p += '6304';
  return p + crc16(p);
}
export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), q = 4, size = n + q * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
// QR em PNG (preto e branco, 1 bit), pro Telegram mandar como foto. Sem compressão: ~20 KB.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function chunk(type, data) {
  const td = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) td[i] = type.charCodeAt(i);
  td.set(data, 4);
  return [...be32(data.length), ...td, ...be32(crc32(td))];
}
export function qrPng(text, scale = 8) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), q = 4, size = (n + q * 2) * scale, rowLen = Math.ceil(size / 8);
  const raw = new Uint8Array((rowLen + 1) * size);
  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / scale) - q, off = y * (rowLen + 1);
    raw[off] = 0; // filtro "none"
    for (let x = 0; x < size; x++) {
      const c = Math.floor(x / scale) - q;
      const dark = r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
      if (!dark) raw[off + 1 + (x >> 3)] |= 0x80 >> (x & 7); // 1 = branco
    }
  }
  // zlib com blocos "stored" (sem compressão)
  const z = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) {
    const len = Math.min(65535, raw.length - i), last = i + len >= raw.length ? 1 : 0;
    z.push(last, len & 255, len >> 8, ~len & 255, (~len >> 8) & 255);
    for (let j = 0; j < len; j++) z.push(raw[i + j]);
  }
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  z.push(...be32(((b << 16) | a) >>> 0));
  const ihdr = new Uint8Array([...be32(size), ...be32(size), 1, 0, 0, 0, 0]);
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr), ...chunk('IDAT', new Uint8Array(z)), ...chunk('IEND', new Uint8Array(0))]);
}
