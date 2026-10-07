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
