import crypto from 'node:crypto';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatStore, createMemoryChatStore } from './chat-store.mjs';
import { createBankStore, createMemoryBankStore } from './bank-store.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf'
};
const csp =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'";
const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function sendJson(res, status, value) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(value));
}
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw Object.assign(new Error('Payload too large'), { status: 413 });
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}
function cookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}
function operatorToken(secret) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
function validOperator(req, secret) {
  if (!secret) return false;
  const [payload, signature] = cookie(req, 'operator_session').split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}
function customerToken(id, secret) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
function validCustomer(req, secret) {
  const [payload, signature] = cookie(req, 'customer_session').split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return value.exp > Date.now() ? value.id : null;
  } catch {
    return null;
  }
}
const cleanText = (value, max) => (typeof value === 'string' ? value.trim().replace(/\0/g, '').slice(0, max) : '');
const normalizeCardNumber = (value) => {
  const raw = cleanText(value, 32);
  if (!/^[\d\s-]+$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  return digits.length === 16 ? digits.match(/.{4}/g).join(' ') : '';
};

export function createServer(options = {}) {
  const store = options.store || createMemoryChatStore();
  const bankStore = options.bankStore || createMemoryBankStore();
  const operatorKey = options.operatorKey ?? process.env.OPERATOR_KEY ?? '';
  const sessionSecret =
    options.sessionSecret || process.env.BANK_SESSION_SECRET || operatorKey || crypto.randomBytes(32).toString('hex');
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/health') return sendJson(res, 200, { status: 'ok' });

      if (pathname === '/api/operator/login' && req.method === 'POST') {
        if (!operatorKey) return sendJson(res, 503, { error: 'OPERATOR_KEY is not configured.' });
        const body = await readJson(req);
        if (!safeEqual(cleanText(body.key, 200), operatorKey)) return sendJson(res, 401, { error: 'Incorrect key.' });
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        res.setHeader(
          'Set-Cookie',
          `operator_session=${encodeURIComponent(operatorToken(operatorKey))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`
        );
        return sendJson(res, 200, { ok: true });
      }
      if (pathname === '/api/operator/logout' && req.method === 'POST') {
        res.setHeader('Set-Cookie', 'operator_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return sendJson(res, 200, { ok: true });
      }
      if (pathname.startsWith('/api/operator/')) {
        if (!validOperator(req, operatorKey)) return sendJson(res, 401, { error: 'Unauthorized.' });
        if (pathname === '/api/operator/sessions' && req.method === 'GET')
          return sendJson(res, 200, { sessions: await store.listSessions() });
        if (pathname === '/api/operator/customers' && req.method === 'GET')
          return sendJson(res, 200, { customers: await bankStore.listCustomers() });
        if (pathname === '/api/operator/customers' && req.method === 'POST') {
          const body = await readJson(req);
          const name = cleanText(body.name, 120);
          const username = cleanText(body.username, 80).toLowerCase();
          const password = cleanText(body.password, 200);
          const currency = cleanText(body.currency, 3).toUpperCase() || 'USD';
          const openingBalance = Number(body.openingBalance ?? 0);
          const requestedAccountNumber = cleanText(body.accountNumber, 40).toUpperCase();
          const requestedCardNumber = body.cardNumber ? normalizeCardNumber(body.cardNumber) : '';
          const requestedCardExpiry = cleanText(body.cardExpiry, 5);
          const requestedCardCvv = cleanText(body.cardCvv, 4);
          if (name.length < 2) return sendJson(res, 400, { error: 'Enter the customer name.' });
          if (!/^[a-z0-9._-]{3,40}$/.test(username))
            return sendJson(res, 400, {
              error: 'Username must be 3–40 characters and may contain letters, numbers, dots, underscores, or hyphens.'
            });
          if (password.length < 8 || password.length > 128)
            return sendJson(res, 400, { error: 'Password must be between 8 and 128 characters.' });
          if (!['USD', 'EUR', 'TRY'].includes(currency)) return sendJson(res, 400, { error: 'Unsupported currency.' });
          if (!Number.isFinite(openingBalance) || openingBalance < 0 || openingBalance > 1_000_000_000)
            return sendJson(res, 400, { error: 'Enter a valid opening balance.' });
          if (requestedAccountNumber && !/^[A-Z0-9 -]{8,40}$/.test(requestedAccountNumber))
            return sendJson(res, 400, { error: 'Enter a valid account number or IBAN.' });
          if (body.cardNumber && !requestedCardNumber)
            return sendJson(res, 400, { error: 'Card number must contain 16 digits.' });
          if (requestedCardExpiry && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(requestedCardExpiry))
            return sendJson(res, 400, { error: 'Expiry must use MM/YY.' });
          if (requestedCardCvv && !/^\d{3,4}$/.test(requestedCardCvv))
            return sendJson(res, 400, { error: 'CVV must contain 3 or 4 digits.' });
          const result = await bankStore.createCustomer({
            name,
            username,
            password,
            currency,
            openingBalance,
            accountNumber: requestedAccountNumber,
            cardNumber: requestedCardNumber,
            cardExpiry: requestedCardExpiry,
            cardCvv: requestedCardCvv
          });
          if (result.error === 'username_exists')
            return sendJson(res, 409, { error: 'That username is already in use.' });
          return sendJson(res, 201, result);
        }
        const customerMatch = pathname.match(
          /^\/api\/operator\/customers\/([0-9a-f-]+)(?:\/(transactions|messages|card-status|card-number))?$/i
        );
        if (customerMatch) {
          const customer = await bankStore.getCustomer(customerMatch[1]);
          if (!customer) return sendJson(res, 404, { error: 'Customer not found.' });
          if (req.method === 'DELETE' && !customerMatch[2]) {
            await bankStore.deleteCustomer(customer.id);
            return sendJson(res, 200, { ok: true });
          }
          if (req.method === 'GET' && !customerMatch[2])
            return sendJson(res, 200, {
              customer,
              transactions: await bankStore.getTransactions(customer.id),
              messages: await bankStore.getMessages(customer.id)
            });
          if (req.method === 'POST' && customerMatch[2] === 'transactions') {
            const body = await readJson(req);
            const type = body.type === 'debit' ? 'debit' : 'credit';
            const dateMode = body.dateMode === 'hidden' || body.dateMode === 'manual' ? body.dateMode : 'automatic';
            const manualDate =
              dateMode === 'manual' && typeof body.createdAt === 'string' && body.createdAt
                ? new Date(body.createdAt)
                : null;
            if (dateMode === 'manual' && (!manualDate || Number.isNaN(manualDate.getTime())))
              return sendJson(res, 400, { error: 'Enter a valid date and time.' });
            const result = await bankStore.transact({
              customerId: customer.id,
              type,
              amount: body.amount,
              description:
                cleanText(body.description, 180) ||
                (type === 'credit' ? 'Direct deposit transaction' : 'Direct debit transaction'),
              actor: 'operator',
              createdAt: manualDate?.toISOString(),
              showDate: dateMode !== 'hidden'
            });
            if (result.error === 'insufficient_funds') return sendJson(res, 409, { error: 'Insufficient funds.' });
            if (result.error) return sendJson(res, 400, { error: 'Invalid amount.' });
            return sendJson(res, 201, result);
          }
          if (req.method === 'POST' && customerMatch[2] === 'messages') {
            const body = await readJson(req);
            const text = cleanText(body.text, 2000);
            if (!text) return sendJson(res, 400, { error: 'Enter a message.' });
            return sendJson(res, 201, {
              message: await bankStore.addMessage({ customerId: customer.id, sender: 'operator', body: text })
            });
          }
          if (req.method === 'PATCH' && customerMatch[2] === 'card-status') {
            const body = await readJson(req);
            if (!['active', 'frozen'].includes(body.status))
              return sendJson(res, 400, { error: 'Invalid card status.' });
            return sendJson(res, 200, { customer: await bankStore.setCardStatus(customer.id, body.status) });
          }
          if (req.method === 'PATCH' && customerMatch[2] === 'card-number') {
            const body = await readJson(req);
            const newCardNumber = normalizeCardNumber(body.cardNumber);
            if (!newCardNumber) return sendJson(res, 400, { error: 'Card number must contain 16 digits.' });
            const result = await bankStore.setCardNumber(customer.id, newCardNumber);
            if (result.error === 'card_number_exists')
              return sendJson(res, 409, { error: 'That card number is already assigned to another customer.' });
            if (result.error) return sendJson(res, 404, { error: 'Customer not found.' });
            return sendJson(res, 200, result);
          }
        }
        const match = pathname.match(/^\/api\/operator\/sessions\/([0-9a-f-]+)\/(messages|status)$/i);
        if (match && req.method === 'GET' && match[2] === 'messages') {
          const session = await store.getSession(match[1]);
          if (!session) return sendJson(res, 404, { error: 'Conversation not found.' });
          return sendJson(res, 200, {
            session,
            messages: await store.getMessages(match[1], Number(url.searchParams.get('after')) || 0)
          });
        }
        if (match && req.method === 'POST' && match[2] === 'messages') {
          const body = await readJson(req);
          const text = cleanText(body.text, 2000);
          if (!text) return sendJson(res, 400, { error: 'Enter a message.' });
          const message = await store.addMessage({ sessionId: match[1], sender: 'operator', body: text });
          return message ? sendJson(res, 201, { message }) : sendJson(res, 404, { error: 'Conversation not found.' });
        }
        if (match && req.method === 'PATCH' && match[2] === 'status') {
          const body = await readJson(req);
          if (!['open', 'closed'].includes(body.status)) return sendJson(res, 400, { error: 'Invalid status.' });
          const session = await store.setStatus(match[1], body.status);
          return session ? sendJson(res, 200, { session }) : sendJson(res, 404, { error: 'Conversation not found.' });
        }
        return sendJson(res, 404, { error: 'Route not found.' });
      }
      if (pathname === '/api/banking/login' && req.method === 'POST') {
        const body = await readJson(req);
        const customer = await bankStore.authenticate(cleanText(body.username, 80), cleanText(body.password, 200));
        if (!customer) return sendJson(res, 401, { error: 'Incorrect username or password.' });
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        res.setHeader(
          'Set-Cookie',
          `customer_session=${encodeURIComponent(customerToken(customer.id, sessionSecret))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`
        );
        return sendJson(res, 200, { customer });
      }
      if (pathname === '/api/banking/logout' && req.method === 'POST') {
        res.setHeader('Set-Cookie', 'customer_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return sendJson(res, 200, { ok: true });
      }
      if (pathname.startsWith('/api/banking/')) {
        const customerId = validCustomer(req, sessionSecret);
        if (!customerId) return sendJson(res, 401, { error: 'Invalid session.' });
        const customer = await bankStore.getCustomer(customerId);
        if (!customer) return sendJson(res, 401, { error: 'Invalid session.' });
        if (pathname === '/api/banking/me' && req.method === 'GET')
          return sendJson(res, 200, {
            customer,
            transactions: await bankStore.getTransactions(customerId, 20),
            messages: await bankStore.getMessages(customerId)
          });
        if (pathname === '/api/banking/transactions' && req.method === 'POST') {
          const body = await readJson(req);
          if (!['deposit', 'withdrawal', 'payment'].includes(body.type))
            return sendJson(res, 400, { error: 'Invalid transaction.' });
          const blockedLabel = {
            deposit: 'Deposits',
            withdrawal: 'Transfers',
            payment: 'Bill payments'
          }[body.type];
          return sendJson(res, 403, {
            error: `${blockedLabel} are disabled. Contact support for assistance.`
          });
        }
        if (pathname === '/api/banking/card-status' && req.method === 'PATCH') {
          const body = await readJson(req);
          if (!['active', 'frozen'].includes(body.status)) return sendJson(res, 400, { error: 'Invalid card status.' });
          return sendJson(res, 200, { customer: await bankStore.setCardStatus(customerId, body.status) });
        }
        if (pathname === '/api/banking/messages' && req.method === 'POST') {
          const body = await readJson(req);
          const text = cleanText(body.text, 2000);
          if (!text) return sendJson(res, 400, { error: 'Enter a message.' });
          return sendJson(res, 201, {
            message: await bankStore.addMessage({ customerId, sender: 'customer', body: text })
          });
        }
        return sendJson(res, 404, { error: 'Route not found.' });
      }
      if (pathname === '/api/chat/sessions' && req.method === 'POST') {
        const body = await readJson(req);
        const token = crypto.randomBytes(32).toString('base64url');
        const session = await store.createSession({
          name: cleanText(body.name, 80) || 'Visitor',
          tokenHash: hash(token)
        });
        return sendJson(res, 201, { session, token });
      }
      const chatMatch = pathname.match(/^\/api\/chat\/sessions\/([0-9a-f-]+)\/messages$/i);
      if (chatMatch && ['GET', 'POST'].includes(req.method)) {
        const token = req.headers['x-chat-token'] || '';
        if (!token || !(await store.verifyVisitor(chatMatch[1], hash(String(token)))))
          return sendJson(res, 401, { error: 'Invalid chat session.' });
        if (req.method === 'GET')
          return sendJson(res, 200, {
            messages: await store.getMessages(chatMatch[1], Number(url.searchParams.get('after')) || 0)
          });
        const body = await readJson(req);
        const text = cleanText(body.text, 2000);
        if (!text) return sendJson(res, 400, { error: 'Enter a message.' });
        const message = await store.addMessage({ sessionId: chatMatch[1], sender: 'visitor', body: text });
        return sendJson(res, 201, { message });
      }

      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        return res.end('Method not allowed');
      }
      let staticPath = pathname;
      if (staticPath === '/') staticPath = '/index.html';
      if (['/operador', '/operador/', '/operator', '/operator/'].includes(staticPath))
        staticPath = '/operador/index.html';
      if (['/internet-banking', '/internet-banking/'].includes(staticPath)) staticPath = '/internet-banking/index.html';
      let filename = path.resolve(root, '.' + staticPath);
      if (!filename.startsWith(root) || staticPath.includes('\\') || staticPath.includes('\0')) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      try {
        let info = await stat(filename);
        if (info.isDirectory()) {
          filename = path.join(filename, 'index.html');
          info = await stat(filename);
        }
        if (!info.isFile()) throw new Error('Not a file');
        res.writeHead(200, {
          'Content-Type': mime[path.extname(filename).toLowerCase()] || 'application/octet-stream',
          'Content-Length': info.size,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': csp,
          'Cache-Control': 'no-cache'
        });
        if (req.method === 'HEAD') return res.end();
        createReadStream(filename)
          .on('error', () => res.destroy())
          .pipe(res);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(req.method === 'HEAD' ? '' : 'Page not found.');
      }
    } catch (error) {
      console.error(error);
      if (!res.headersSent)
        sendJson(res, error.status || 500, { error: error.status ? error.message : 'Error interno.' });
      else res.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const store = await createChatStore();
  const bankStore = await createBankStore();
  const server = createServer({ store, bankStore });
  server.listen(port, host, () => console.log(`App ready: http://localhost:${port}/ · operator: /operator`));
  const shutdown = () =>
    server.close(async () => {
      await Promise.all([store.close(), bankStore.close()]);
      process.exit(0);
    });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
