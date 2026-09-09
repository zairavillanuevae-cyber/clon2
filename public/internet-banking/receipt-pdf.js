const encoder = new TextEncoder();

function ascii(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

function pdfText(value) {
  return ascii(value).replace(/([\\()])/g, '\\$1');
}

function short(value, limit = 70) {
  const clean = ascii(value).replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit - 3)}...` : clean;
}

function text(value, x, y, size = 11, font = 'F1', color = '0.16 0.14 0.15') {
  return `${color} rg BT /${font} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET`;
}

function money(amount, currency) {
  const value = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);
  return `${value} ${ascii(currency || 'USD').toUpperCase()}`;
}

function maskAccount(value) {
  const compact = String(value || '').replace(/\s/g, '');
  return `Account ending in ${compact.slice(-4) || '----'}`;
}

function formatDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed);
}

function join(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function createTransferReceiptPdf(receipt) {
  const referenceId = `TX-${String(receipt.id ?? '').padStart(6, '0')}`;
  const commands = [
    '0.882 0.02 0.078 rg 0 720 595 122 re f',
    text('NOVA BANK', 50, 787, 16, 'F2', '1 1 1'),
    text('DIGITAL BANKING', 50, 770, 8, 'F1', '1 0.82 0.84'),
    text('TRANSFER RECEIPT', 390, 779, 10, 'F2', '1 1 1'),
    text('Transfer confirmation', 50, 673, 30, 'F2'),
    text('This document confirms that the transfer was completed successfully.', 50, 649, 11, 'F1', '0.45 0.42 0.43'),
    '0.99 0.93 0.94 rg 50 577 495 49 re f',
    text('COMPLETED', 70, 596, 11, 'F2', '0.07 0.53 0.36'),
    text(referenceId, 420, 596, 10, 'F2', '0.45 0.42 0.43'),
    text('AMOUNT SENT', 50, 535, 9, 'F2', '0.45 0.42 0.43'),
    text(money(receipt.amount, receipt.currency), 50, 495, 32, 'F2', '0.882 0.02 0.078'),
    '0.90 0.88 0.89 RG 50 468 m 545 468 l S',
    text('Recipient name', 50, 433, 9, 'F2', '0.45 0.42 0.43'),
    text(short(receipt.recipientName, 58), 220, 433, 12, 'F2'),
    text('Recipient account', 50, 398, 9, 'F2', '0.45 0.42 0.43'),
    text(short(receipt.recipientAccount, 58), 220, 398, 12, 'F1'),
    text('From', 50, 363, 9, 'F2', '0.45 0.42 0.43'),
    text(maskAccount(receipt.accountNumber), 220, 363, 12, 'F1'),
    text('Date and time', 50, 328, 9, 'F2', '0.45 0.42 0.43'),
    text(short(formatDate(receipt.createdAt), 58), 220, 328, 12, 'F1'),
    text('Reference', 50, 293, 9, 'F2', '0.45 0.42 0.43'),
    text(short(receipt.reference || 'No reference provided', 58), 220, 293, 12, 'F1'),
    '0.90 0.88 0.89 RG 50 265 m 545 265 l S',
    text('BALANCE AFTER TRANSFER', 50, 227, 9, 'F2', '0.45 0.42 0.43'),
    text(money(receipt.balance, receipt.currency), 50, 199, 18, 'F2'),
    '0.97 0.96 0.96 rg 50 112 495 66 re f',
    text('Keep this receipt for your records.', 70, 148, 11, 'F2'),
    text('Generated securely by Digital Banking.', 70, 130, 9, 'F1', '0.45 0.42 0.43'),
    text(' - Page 1 of 1', 50, 55, 8, 'F1', '0.55 0.52 0.53')
  ].join('\n');
  const content = encoder.encode(commands);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${commands}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ];
  const parts = [encoder.encode('%PDF-1.4\n%NovaBank\n')];
  const offsets = [0];
  let byteLength = parts[0].length;
  objects.forEach((object, index) => {
    offsets[index + 1] = byteLength;
    const bytes = encoder.encode(`${index + 1} 0 obj\n${object}\nendobj\n`);
    parts.push(bytes);
    byteLength += bytes.length;
  });
  const xrefOffset = byteLength;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  ].join('\n');
  parts.push(encoder.encode(xref));
  return join(parts);
}
