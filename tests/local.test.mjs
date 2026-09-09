import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from '../server.mjs';
import { depositTotal, monthlyPayment } from '../public/calculations.js';
import { getVisitorId, visitorDisplayName } from '../public/visitor-identity.js';
import { createTransferReceiptPdf } from '../public/internet-banking/receipt-pdf.js';

test('deposit uses the selected rate, term and withholding', () => {
  assert.equal(depositTotal(10000, 30, 365, 0), 13000);
  assert.equal(depositTotal(10000, 30, 365, 17.5), 12475);
  assert.equal(depositTotal(10000, 0, 32), 10000);
  assert.equal(depositTotal(-100, 30, 32), null);
  assert.equal(depositTotal(10000, 30, 0), null);
  assert.equal(depositTotal(NaN, 30, 32), null);
});
test('loan repayment handles interest, zero interest and invalid inputs', () => {
  assert.equal(monthlyPayment(12000, 0, 12), 1000);
  assert.ok(Math.abs(monthlyPayment(10000, 1, 12) - 888.4878867834) < 0.00001);
  assert.equal(monthlyPayment(10000, 3, 0), null);
  assert.equal(monthlyPayment(10000, -3, 12), null);
});
test('visitor identity is stable in browser storage and has a short display name', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const cryptoApi = { randomUUID: () => '8d12f63e-aaaa-4bbb-8ccc-123456789abc' };
  const firstId = getVisitorId(storage, cryptoApi);
  assert.equal(firstId, '8d12f63e-aaaa-4bbb-8ccc-123456789abc');
  assert.equal(getVisitorId(storage, { randomUUID: () => assert.fail('must reuse the stored UUID') }), firstId);
  assert.equal(visitorDisplayName(firstId), 'Visitor 8D12F6');
});
test('transfer receipt generator creates a valid one-page PDF', () => {
  const pdf = createTransferReceiptPdf({
    id: 42,
    amount: 140.5,
    currency: 'USD',
    recipientName: 'Maria Alvarez',
    recipientAccount: 'ES91 2100 0418 4502 0005 1332',
    reference: 'September invoice',
    accountNumber: 'TR00 0000 0000 0000 0000 0001',
    balance: 12700,
    createdAt: '2026-09-09T15:30:00.000Z'
  });
  const contents = new TextDecoder().decode(pdf);
  assert.equal(contents.slice(0, 8), '%PDF-1.4');
  assert.match(contents, /TRANSFER RECEIPT/);
  assert.match(contents, /Maria Alvarez/);
  assert.match(contents, /ES91 2100 0418 4502 0005 1332/);
  assert.match(contents, /%%EOF/);
  assert.ok(pdf.length > 2000);
});
test('a transfer is returned after its delay and its notification can be dismissed', async (t) => {
  const server = createServer({
    sessionSecret: 'refund-session-secret',
    transferReversalDelayMs: 15
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/banking/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'customer.portal', password: 'Portal2026!' })
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const transfer = await fetch(base + '/api/banking/transactions', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'withdrawal', amount: 40, description: 'Return test' })
  });
  assert.equal(transfer.status, 201);
  assert.equal((await transfer.json()).customer.balance, 12800.5);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const notificationResponse = await fetch(base + '/api/banking/notifications', { headers: { cookie } });
  assert.equal(notificationResponse.status, 200);
  const notificationData = await notificationResponse.json();
  assert.equal(notificationData.customer.balance, 12840.5);
  assert.equal(notificationData.notifications.length, 1);
  assert.equal(notificationData.notifications[0].amount, 40);
  const notificationId = notificationData.notifications[0].id;
  const dismissed = await fetch(`${base}/api/banking/notifications/${notificationId}`, {
    method: 'PATCH',
    headers: { cookie }
  });
  assert.equal(dismissed.status, 200);
  const afterDismiss = await (
    await fetch(base + '/api/banking/notifications', { headers: { cookie } })
  ).json();
  assert.deepEqual(afterDismiss.notifications, []);
  const account = await (await fetch(base + '/api/banking/me', { headers: { cookie } })).json();
  assert.equal(account.transactions[0].type, 'reversal');
});
test('local HTTP server serves the homepage, assets and health, and rejects non-public paths', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.match(html, /Western Union Transfers/);
    assert.doesNotMatch(html, /<script[^>]+src="https?:/);
    assert.doesNotMatch(html, /__VIEWSTATE|__EVENTVALIDATION/);
  }
  const removedLanguagePrefix = '/' + 'en';
  assert.equal((await fetch(base + removedLanguagePrefix)).status, 404);
  assert.equal((await fetch(base + `${removedLanguagePrefix}/`)).status, 404);
  assert.deepEqual(await (await fetch(base + '/health')).json(), { status: 'ok' });
  const pages = new Map([
    ['/product-and-service-fees', 'Product and Service Fees'],
    ['/our-bank', 'Our Bank'],
    ['/investor-relations', 'Investor Relations'],
    ['/digital-banking', 'Digital Banking'],
    ['/retail', 'Retail'],
    ['/commercial', 'Commercial'],
    ['/corporate', 'Corporate'],
    ['/tr', 'Ｚiraat Bankası']
  ]);
  for (const [route, heading] of pages) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), new RegExp(heading), route);
  }
  const menuPages = [
    ['/retail', ['accounts', 'loans', 'cards', 'payments', 'services', 'insurance-pension', 'investment']],
    [
      '/commercial',
      ['accounts', 'cards', 'loans', 'foreign-trade', 'cash-management', 'pos-services', 'investment', 'agriculture']
    ],
    ['/corporate', ['accounts', 'loans', 'foreign-trade', 'cards', 'cash-management', 'investment', 'agriculture']]
  ];
  for (const [section, slugs] of menuPages)
    for (const slug of slugs) {
      const response = await fetch(`${base}${section}/${slug}`);
      assert.equal(response.status, 200, `${section}/${slug}`);
      assert.match(await response.text(), /clone-(?:card-grid|detail)/, `${section}/${slug}`);
    }
  const home = await (await fetch(base + '/')).text();
  assert.match(home, /data-src="\/Banners\/qr-red\.png"/);
  assert.match(home, /data-mobile-src="\/PublishingImages\/qr-red-mobile\.png"/);
  assert.doesNotMatch(home, /data-src="\/Banners\/QR\.jpg"/);
  for (const asset of ['/Banners/qr-red.png', '/PublishingImages/qr-red-mobile.png']) {
    assert.equal((await fetch(base + asset, { method: 'HEAD' })).status, 200, asset);
  }
  for (const [section, slugs] of menuPages)
    for (const slug of slugs) {
      assert.match(home, new RegExp(`href="${section}/${slug}"`), `${section}/${slug}`);
    }
  const footerPages = [
    ['/our-bank/about-us/ziraat-finans-group/domestic-subsidiaries', 'Local Subsidiaries'],
    [
      '/our-bank/about-us/ziraat-finans-group/subsidiaries-abroad-overseas-branches-and-representative-offices',
      'Subsidiaries Abroad'
    ],
    ['/our-bank/press-room/news-announcements', 'News &amp; Announcements'],
    ['/calculation-tools', 'Calculation Tools'],
    ['/sitemap', 'Site Map'],
    ['/faq', 'FAQ'],
    ['/tr/bankamiz/ziraatten-duyurular/duyurular/zamanasimina-ugrayan-mevduat-ve-emanet-hesaplari', 'Time Out Account'],
    ['/calculation-tools/iban', 'IBAN'],
    ['/legal-notice', 'Legal Notice'],
    ['/contact-us/branches-atms', 'Branches &amp; ATMs'],
    ['/contact-us/contact-form', 'Contact Form'],
    ['/our-bank/announcements/disclosure-of-protection-of-personal-data', 'Personal Data Protection']
  ];
  for (const [route, heading] of footerPages) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), new RegExp(heading), route);
    assert.match(home, new RegExp(`href="${route}"`), route);
  }
  const sitemap = await (await fetch(base + '/sitemap')).text();
  const sitemapLinks = [...sitemap.matchAll(/<a\b[^>]*\bhref=(["'])(.*?)\1/gi)].map((match) => match[2]);
  assert.ok(sitemapLinks.length > 100, 'sitemap should preserve its complete link list');
  assert.ok(
    sitemapLinks.every((href) => href === '/'),
    'every sitemap link should return to the homepage'
  );
  assert.doesNotMatch(sitemap, /<a\b[^>]*\btarget=["']_blank["']/i);
  const heroPages = [
    ['/retail/services/western-union', 'Western Union', true],
    ['/digital-banking/mobile-banking/ziraat-mobil', 'Ｚiraat Mobil', true],
    ['/digital-banking/mobile-banking/ziraat-mobile-corporate', 'Ｚiraat Mobile Corporate', false]
  ];
  for (const [route, heading, linkedFromHome] of heroPages) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), new RegExp(`<h1>${heading}</h1>`), route);
    if (linkedFromHome) {
      assert.match(home, new RegExp(`href="${route}"`), route);
    } else {
      assert.doesNotMatch(home, new RegExp(`href="${route}"`), route);
    }
  }
  assert.equal((await fetch(base + '/recursos/original.html')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e%5cpackage.json')).status, 403);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/', { method: 'HEAD' })).status, 200);
  const manifest = JSON.parse(await readFile(new URL('../recursos/assets-manifest.json', import.meta.url)));
  for (const asset of manifest) {
    const response = await fetch(base + '/' + asset.file.replace('public/', ''), { method: 'HEAD' });
    assert.equal(response.status, 200, asset.file);
    assert.ok(Number(response.headers.get('content-length')) > 0, asset.file);
  }
  const css = await readFile(new URL('../public/SiteAssets/css/min/magiclick.min.css', import.meta.url), 'utf8');
  const localUrls = [...new Set([...css.matchAll(/url\(["']?(\/[^)"']+)/g)].map((m) => m[1]))];
  for (const url of localUrls) assert.equal((await fetch(base + url, { method: 'HEAD' })).status, 200, url);
});

test('visitor and authenticated operator can exchange chat messages', async (t) => {
  const server = createServer({ operatorKey: 'test-operator-secret' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(base + '/operador')).status, 200);
  const createdResponse = await fetch(base + '/api/chat/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const visitorHeaders = { 'content-type': 'application/json', 'x-chat-token': created.token };
  const sent = await fetch(`${base}/api/chat/sessions/${created.session.id}/messages`, {
    method: 'POST',
    headers: visitorHeaders,
    body: JSON.stringify({ text: 'Necesito ayuda' })
  });
  assert.equal(sent.status, 201);
  assert.equal(
    (
      await fetch(`${base}/api/chat/sessions/${created.session.id}/messages`, {
        headers: { 'x-chat-token': 'wrong-token' }
      })
    ).status,
    401
  );

  const denied = await fetch(base + '/api/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'wrong' })
  });
  assert.equal(denied.status, 401);
  const login = await fetch(base + '/api/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'test-operator-secret' })
  });
  assert.equal(login.status, 200);
  const operatorCookie = login.headers.get('set-cookie').split(';')[0];
  const sessions = await (await fetch(base + '/api/operator/sessions', { headers: { cookie: operatorCookie } })).json();
  assert.equal(sessions.sessions.length, 1);
  assert.equal(sessions.sessions[0].lastMessage, 'Necesito ayuda');
  const reply = await fetch(`${base}/api/operator/sessions/${created.session.id}/messages`, {
    method: 'POST',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Hola, te atendemos.' })
  });
  assert.equal(reply.status, 201);
  const messages = await (
    await fetch(`${base}/api/chat/sessions/${created.session.id}/messages`, {
      headers: { 'x-chat-token': created.token }
    })
  ).json();
  assert.deepEqual(
    messages.messages.map((item) => item.sender),
    ['visitor', 'operator']
  );
});

test('customer transfers are available while deposits and payments remain blocked', async (t) => {
  const server = createServer({ operatorKey: 'test-operator-secret', sessionSecret: 'test-session-secret' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(base + '/internet-banking')).status, 200);
  const login = await fetch(base + '/api/banking/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'customer.portal', password: 'Portal2026!' })
  });
  assert.equal(login.status, 200);
  const customerCookie = login.headers.get('set-cookie').split(';')[0];
  const before = await (await fetch(base + '/api/banking/me', { headers: { cookie: customerCookie } })).json();
  assert.equal(before.customer.balance, 12840.5);
  const withdrawal = await fetch(base + '/api/banking/transactions', {
    method: 'POST',
    headers: { cookie: customerCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'withdrawal', amount: 140.5, description: 'Test withdrawal' })
  });
  assert.equal(withdrawal.status, 201);
  const withdrawalData = await withdrawal.json();
  assert.equal(withdrawalData.customer.balance, 12700);
  assert.equal(withdrawalData.transaction.type, 'withdrawal');
  assert.equal(withdrawalData.transaction.actor, 'customer');
  const payment = await fetch(base + '/api/banking/transactions', {
    method: 'POST',
    headers: { cookie: customerCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'payment', amount: 25, description: 'Electric bill' })
  });
  assert.equal(payment.status, 403);
  const denied = await fetch(base + '/api/banking/transactions', {
    method: 'POST',
    headers: { cookie: customerCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'withdrawal', amount: 999999 })
  });
  assert.equal(denied.status, 409);
  const depositDenied = await fetch(base + '/api/banking/transactions', {
    method: 'POST',
    headers: { cookie: customerCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'deposit', amount: 50 })
  });
  assert.equal(depositDenied.status, 403);

  const operatorLogin = await fetch(base + '/api/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'test-operator-secret' })
  });
  const operatorCookie = operatorLogin.headers.get('set-cookie').split(';')[0];
  const createdCustomer = await fetch(base + '/api/operator/customers', {
    method: 'POST',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Alex Morgan',
      username: 'alex.morgan',
      password: 'SecurePass123!',
      openingBalance: 250,
      currency: 'EUR',
      accountNumber: 'TR99 1234 5678 9012 3456 7890',
      cardNumber: '4543 6701 2222 3333',
      cardExpiry: '09/30',
      cardCvv: '731'
    })
  });
  assert.equal(createdCustomer.status, 201);
  const createdCustomerData = await createdCustomer.json();
  assert.equal(createdCustomerData.customer.balance, 250);
  assert.equal(createdCustomerData.customer.currency, 'EUR');
  assert.equal(createdCustomerData.customer.accountNumber, 'TR99 1234 5678 9012 3456 7890');
  assert.equal(createdCustomerData.customer.cardNumber, '4543 6701 2222 3333');
  assert.equal(createdCustomerData.customer.cardExpiry, '09/30');
  assert.equal(createdCustomerData.customer.cardCvv, '731');
  const cardFrozen = await fetch(`${base}/api/banking/card-status`, {
    method: 'PATCH',
    headers: { cookie: customerCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'frozen' })
  });
  assert.equal(cardFrozen.status, 200);
  assert.equal((await cardFrozen.json()).customer.cardStatus, 'frozen');
  const frozenPayment = await fetch(base + '/api/banking/transactions', {
    method: 'POST',
    headers: { cookie: customerCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'payment', amount: 10, description: 'Blocked payment' })
  });
  assert.equal(frozenPayment.status, 403);
  const duplicateCustomer = await fetch(base + '/api/operator/customers', {
    method: 'POST',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Another Alex',
      username: 'alex.morgan',
      password: 'AnotherPass123!',
      openingBalance: 0,
      currency: 'USD'
    })
  });
  assert.equal(duplicateCustomer.status, 409);
  const newLogin = await fetch(base + '/api/banking/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alex.morgan', password: 'SecurePass123!' })
  });
  assert.equal(newLogin.status, 200);
  const customers = await (
    await fetch(base + '/api/operator/customers', { headers: { cookie: operatorCookie } })
  ).json();
  assert.equal(customers.customers.length, 2);
  const id = customers.customers[0].id;
  const invalidCardEdit = await fetch(`${base}/api/operator/customers/${id}/card-number`, {
    method: 'PATCH',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ cardNumber: '1234' })
  });
  assert.equal(invalidCardEdit.status, 400);
  const cardEdit = await fetch(`${base}/api/operator/customers/${id}/card-number`, {
    method: 'PATCH',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ cardNumber: '5555666677778888' })
  });
  assert.equal(cardEdit.status, 200);
  assert.equal((await cardEdit.json()).customer.cardNumber, '5555 6666 7777 8888');
  const customerAfterCardEdit = await (
    await fetch(base + '/api/banking/me', { headers: { cookie: customerCookie } })
  ).json();
  assert.equal(customerAfterCardEdit.customer.cardNumber, '5555 6666 7777 8888');
  const duplicateCardEdit = await fetch(`${base}/api/operator/customers/${id}/card-number`, {
    method: 'PATCH',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ cardNumber: createdCustomerData.customer.cardNumber })
  });
  assert.equal(duplicateCardEdit.status, 409);
  const credit = await fetch(`${base}/api/operator/customers/${id}/transactions`, {
    method: 'POST',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'credit', amount: 300, description: 'Approved adjustment' })
  });
  assert.equal(credit.status, 201);
  assert.equal((await credit.json()).customer.balance, 13000);
  const hiddenDateCredit = await fetch(`${base}/api/operator/customers/${id}/transactions`, {
    method: 'POST',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'credit',
      amount: 10,
      description: 'Private date adjustment',
      dateMode: 'hidden'
    })
  });
  assert.equal(hiddenDateCredit.status, 201);
  const hiddenDateData = await hiddenDateCredit.json();
  assert.equal(hiddenDateData.transaction.showDate, false);
  assert.ok(hiddenDateData.transaction.createdAt);

  const chosenDate = '2024-12-24T19:45:00.000Z';
  const manualDateCredit = await fetch(`${base}/api/operator/customers/${id}/transactions`, {
    method: 'POST',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'credit',
      amount: 20,
      description: 'Scheduled adjustment',
      dateMode: 'manual',
      createdAt: chosenDate
    })
  });
  assert.equal(manualDateCredit.status, 201);
  const manualDateData = await manualDateCredit.json();
  assert.equal(manualDateData.transaction.showDate, true);
  assert.equal(manualDateData.transaction.createdAt, chosenDate);

  const invalidManualDate = await fetch(`${base}/api/operator/customers/${id}/transactions`, {
    method: 'POST',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'credit', amount: 15, dateMode: 'manual' })
  });
  assert.equal(invalidManualDate.status, 400);
  await fetch(base + '/api/banking/messages', {
    method: 'POST',
    headers: { cookie: customerCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'I need help with my withdrawal.' })
  });
  await fetch(`${base}/api/operator/customers/${id}/messages`, {
    method: 'POST',
    headers: { cookie: operatorCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'We are reviewing it.' })
  });
  const after = await (await fetch(base + '/api/banking/me', { headers: { cookie: customerCookie } })).json();
  assert.deepEqual(
    after.messages.map((item) => item.sender),
    ['customer', 'operator']
  );
  const deleted = await fetch(`${base}/api/operator/customers/${createdCustomerData.customer.id}`, {
    method: 'DELETE',
    headers: { cookie: operatorCookie }
  });
  assert.equal(deleted.status, 200);
  const customersAfterDelete = await (
    await fetch(base + '/api/operator/customers', { headers: { cookie: operatorCookie } })
  ).json();
  assert.equal(customersAfterDelete.customers.length, 1);
  const deletedLogin = await fetch(base + '/api/banking/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alex.morgan', password: 'SecurePass123!' })
  });
  assert.equal(deletedLogin.status, 401);
});
