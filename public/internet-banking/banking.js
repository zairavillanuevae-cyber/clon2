import { createTransferReceiptPdf } from './receipt-pdf.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { data: null, view: 'home', balanceVisible: false, cardVisible: false };
let activeCurrency = 'USD';
let activeBlockedOperation = 'deposit';
let latestReceipt = null;
let toastTimer = null;
let refundPolling = false;
let activeRefundNotificationId = null;

const blockedOperations = {
  deposit: {
    title: 'Deposits are currently blocked',
    copy: 'Contact our support team to request deposit access for your account.',
    message: 'Hello, I need help enabling deposits on my account.'
  },
  withdrawal: {
    title: 'Transfers are currently blocked',
    copy: 'Contact our support team to request transfer access for your account.',
    message: 'Hello, I need help enabling transfers on my account.'
  },
  payment: {
    title: 'Bill payments are currently blocked',
    copy: 'Contact our support team to request bill payment access for your account.',
    message: 'Hello, I need help enabling bill payments on my account.'
  }
};

const money = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: activeCurrency, minimumFractionDigits: 2 }).format(
    value
  );
const date = (value) =>
  new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>'"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]
  );

const icons = {
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6 4 16Z"/><path d="m14.5 7.1 2.4 2.4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7.4 18-3.1-7.5L3 10.4 21 3Z"/><path d="m10.5 13.5 5-5"/></svg>',
  qr: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM15 14h2v2h-2zM19 14h1v3h-3M14 19h3v1h-3zM20 20h.01"/></svg>',
  drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12Z"/><path d="M9.5 16.5c.5 1 1.3 1.5 2.5 1.5"/></svg>',
  transfer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/></svg>',
  deposit:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10M8 7l4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.3.9-1.3 1.9M12 17h.01"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>'
};

async function api(url, options) {
  const response = await fetch(url, options);
  let data = {};
  try {
    data = await response.json();
  } catch {}
  if (response.status === 401) {
    showLogin();
    throw new Error('Your session has expired.');
  }
  if (!response.ok) throw new Error(data.error || 'We could not complete your request.');
  return data;
}

function initials(name) {
  return (
    String(name || '')
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'CL'
  );
}
function maskAccount(value) {
  return `•••• ${String(value || '')
    .replace(/\s/g, '')
    .slice(-4)}`;
}
function maskCard(value) {
  return `•••• •••• •••• ${String(value || '')
    .replace(/\s/g, '')
    .slice(-4)}`;
}
function transactionLabel(type) {
  return type === 'payment'
    ? 'Payment'
    : type === 'withdrawal'
      ? 'Transfer'
      : type === 'reversal'
        ? 'Returned transfer'
      : type === 'opening'
        ? 'Opening balance'
        : 'Credit';
}
function txRow(transaction) {
  const debit = ['withdrawal', 'debit', 'payment'].includes(transaction.type);
  const meta =
    transaction.showDate === false
      ? transactionLabel(transaction.type)
      : `${transactionLabel(transaction.type)} · ${date(transaction.createdAt)}`;
  return `<article class="tx ${escape(transaction.type)}">
    <span class="tx-icon" aria-hidden="true">${debit ? '−' : '+'}</span>
    <div><p>${escape(transaction.description)}</p><small>${meta}</small></div>
    <strong>${debit ? '−' : '+'}${money(transaction.amount)}</strong>
  </article>`;
}
function messageRow(message) {
  return `<p class="message ${escape(message.sender)}">${escape(message.body)}<time>${date(message.createdAt)}</time></p>`;
}
function productRows(customer) {
  const status = customer.cardStatus === 'frozen' ? 'Frozen' : 'Active';
  return `<div class="product-list">
    <button class="product-row" type="button" data-go="activity">
      <span class="product-symbol account-symbol"><img src="/internet-banking/nova-edu-mark.png" alt="" /></span>
      <span class="product-copy"><strong>${escape(customer.currency)} ACCOUNT</strong><small>${escape(maskAccount(customer.accountNumber))}</small></span>
      <span class="product-value"><strong id="balance-value" data-value="${escape(money(customer.balance))}">••••••</strong><small>Available balance</small></span>
      <span class="row-arrow">${icons.arrow}</span>
    </button>
    <button class="product-row" type="button" data-go="card">
      <span class="product-symbol card-symbol">V</span>
      <span class="product-copy"><strong>Debit card</strong><small>${escape(maskCard(customer.cardNumber))}</small></span>
      <span class="product-value"><strong>${status}</strong><small>Card status</small></span>
      <span class="row-arrow">${icons.arrow}</span>
    </button>
  </div>`;
}
function cardVisual(customer, compact = false) {
  const numberAttributes = compact ? '' : `id="card-number" data-value="${escape(customer.cardNumber)}"`;
  const cvvAttributes = compact ? '' : `id="card-cvv" data-value="${escape(customer.cardCvv)}"`;
  return `<div class="debit-card ${compact ? 'compact-card' : ''} ${customer.cardStatus === 'frozen' ? 'is-frozen' : ''}">
    <div class="debit-card-top"><span class="card-brand"><img src="/internet-banking/nova-edu-mark.png" alt="" /></span><strong>VISA</strong></div>
    ${compact ? '' : '<button id="reveal-card" type="button">Show details</button>'}
    <div class="card-number" ${numberAttributes}>${escape(maskCard(customer.cardNumber))}</div>
    <div class="card-secrets"><span><small>VALID THRU</small><strong>${escape(customer.cardExpiry)}</strong></span><span><small>CVV</small><strong ${cvvAttributes}>•••</strong></span></div>
  </div>`;
}
function operationForm(type) {
  const payment = type === 'payment';
  if (!payment)
    return `<form class="operation-form" data-transaction-form="withdrawal">
      <div class="form-intro-row"><div><span class="form-index">SEND</span><h2>Make a transfer</h2></div><small>Available ${money(state.data.customer.balance)}</small></div>
      <label>Recipient name<input name="recipientName" maxlength="80" placeholder="Full name" required /></label>
      <label>Recipient account<input name="recipientAccount" maxlength="40" placeholder="IBAN or account number" autocomplete="off" spellcheck="false" required /></label>
      <label>Amount<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00 ${escape(activeCurrency)}" required /></label>
      <label>Reference<textarea name="description" maxlength="180" rows="3" placeholder="Add a note (optional)"></textarea></label>
      <div class="transfer-progress" data-transfer-progress role="status" aria-live="polite" hidden>
        <span class="transfer-spinner" aria-hidden="true"></span>
        <div><strong>Transfer pending</strong><small data-transfer-countdown>Processing securely · 5 seconds remaining</small></div>
      </div>
      <button class="primary operation-submit" type="submit"><b data-submit-label>Send transfer</b><span data-submit-state>Continue</span></button>
      <p class="form-assurance">Your balance updates immediately after a successful transfer.</p>
    </form>`;
  return `<section class="operation-form blocked-operation-card" aria-labelledby="${type}-blocked-title">
    <div class="form-intro-row"><div><span class="form-index">${payment ? 'PAY' : 'SEND'}</span><h2>${payment ? 'Pay a bill' : 'Make a transfer'}</h2></div><small>Available ${money(state.data.customer.balance)}</small></div>
    <div class="blocked-operation-main">
      <span class="blocked-operation-icon" aria-hidden="true">${icons.lock}</span>
      <p>TRANSACTION BLOCKED</p>
      <h3 id="${type}-blocked-title">${payment ? 'Bill payments are unavailable' : 'Transfers are unavailable'}</h3>
      <span>You cannot enter or submit transaction details while this service is blocked. Contact support to request access.</span>
    </div>
    <button class="primary operation-submit" type="button" data-contact-blocked-operation="${type}">Contact support<span>Open chat</span></button>
    <p class="form-assurance">Your balance and account remain protected.</p>
  </section>`;
}

function renderDashboard(data) {
  const customer = data.customer;
  const recent = data.transactions.slice(0, 3);
  const payments = [
    ['Electricity', 'Power service'],
    ['Phone', 'Mobile or landline'],
    ['Internet', 'Home connectivity']
  ];
  $('#dashboard').innerHTML = `<div class="views-shell">
    <section class="bank-view home-view" data-page="home">
      <div class="home-layout">
        <section class="products-panel">
          <header class="section-head"><div><p>Overview</p><h2>Your products</h2></div><div class="section-tools"><button id="toggle-balance" type="button" aria-label="Show balances">${icons.eye}</button><button type="button" data-go="card" aria-label="Manage products">${icons.edit}</button></div></header>
          ${productRows(customer)}
          <button class="see-all" type="button" data-go="activity">View all</button>
        </section>

        <section class="quick-section" aria-labelledby="quick-title">
          <div class="section-title-row"><h2 id="quick-title">What would you like to do?</h2><small>Quick access</small></div>
          <div class="quick-actions">
            <button type="button" data-go="transfer"><span>${icons.send}</span><strong>Send to<br />a contact<small>Available</small></strong></button>
            <button class="locked-action" type="button" data-go="payments"><span>${icons.qr}<i class="lock-badge">${icons.lock}</i></span><strong>Pay with<br />QR<small>Blocked</small></strong></button>
            <button class="locked-action" type="button" data-go="payments"><span>${icons.drop}<i class="lock-badge">${icons.lock}</i></span><strong>Pay<br />bills<small>Blocked</small></strong></button>
            <button type="button" data-go="transfer"><span>${icons.transfer}</span><strong>Transfer<br />money<small>Available</small></strong></button>
            <button class="locked-action" type="button" data-deposit><span>${icons.deposit}<i class="lock-badge">${icons.lock}</i></span><strong>Deposit<br /><small>Blocked</small></strong></button>
          </div>
        </section>

        <section class="featured-section">
          <div class="section-title-row"><h2>Featured for you</h2><button type="button" data-go="card">View all</button></div>
          <div class="featured-scroll">
            <button class="feature-card feature-card-blue" type="button" data-go="card"><span class="feature-visual">${icons.card}</span><span><small>Your card</small><strong>Manage your purchases</strong><em>Activate or freeze it whenever you need</em></span><b>New</b></button>
            <button class="feature-card feature-card-orange" type="button" data-open-chat><span class="feature-visual">${icons.help}</span><span><small>Direct support</small><strong>We are here to help</strong><em>Chat with our support team</em></span></button>
            <button class="feature-card feature-card-green" type="button" data-go="activity"><span class="feature-visual">${icons.shield}</span><span><small>Security</small><strong>Everything under control</strong><em>Review your latest activity</em></span></button>
          </div>
          <div class="carousel-dots" aria-hidden="true"><i class="active"></i><i></i><i></i><i></i></div>
        </section>

        <section class="recent-panel recent-panel-locked" aria-label="Latest transactions are locked">
          <div class="recent-panel-private" aria-hidden="true" inert>
            <header class="section-head"><div><p>Activity</p><h2>Latest transactions</h2></div><button class="text-link" type="button" data-go="activity" tabindex="-1">View all</button></header>
            <div class="tx-list">${recent.map(txRow).join('') || '<p class="empty-copy">Your transactions will appear here.</p>'}</div>
          </div>
          <button class="recent-lock-overlay" type="button" data-open-chat aria-label="Contact support to unlock your latest transactions">
            <span class="recent-lock-icon" aria-hidden="true">${icons.lock}</span>
            <span class="recent-lock-copy"><small>RESTRICTED ACCESS</small><strong>Transactions are locked</strong><em>Contact support to review your recent activity.</em></span>
            <span class="recent-lock-action">Contact support <b>Open chat</b></span>
          </button>
        </section>
      </div>
    </section>

    <section class="bank-view operation-view" data-page="transfer" hidden>
      <div class="editorial-head"><p>Move your money</p><h2>Transfer securely and simply.</h2><span>Enter the recipient, amount, and an optional reference to send money from your account.</span></div>
      <div class="operation-layout">${operationForm('withdrawal')}<aside class="context-panel"><span>FROM ACCOUNT</span><strong>${escape(customer.accountNumber)}</strong><div><small>Available balance</small><b>${money(customer.balance)}</b></div><p>Transfers are debited from your primary ${escape(customer.currency)} account.</p></aside></div>
    </section>

    <section class="bank-view operation-view" data-page="payments" hidden>
      <div class="editorial-head"><p>Everyday payments</p><h2>Bill payment service is currently unavailable.</h2><span>Payment details cannot be entered while bill payments are blocked.</span></div>
      <div class="payee-strip is-blocked">${payments.map(([name, detail], index) => `<button type="button" disabled><span>0${index + 1}</span><strong>${name}</strong><small>${detail}</small></button>`).join('')}</div>
      <div class="operation-layout">${operationForm('payment')}<aside class="context-panel payment-context"><span>PAYMENT STATUS</span><strong>Currently blocked</strong><div><small>Card ending in</small><b>${escape(String(customer.cardNumber).replace(/\s/g, '').slice(-4))}</b></div><p>Bill payments require support activation before they can be processed.</p><button type="button" data-contact-blocked-operation="payment">Contact support</button></aside></div>
    </section>

    <section class="bank-view card-view" data-page="card" hidden>
      <div class="editorial-head"><p>Card controls</p><h2>Your card, under your control.</h2><span>Show the details only when you need them, or freeze your card instantly.</span></div>
      <div class="card-layout"><div>${cardVisual(customer)}</div><aside class="card-control-panel"><span class="card-status ${escape(customer.cardStatus)}">${customer.cardStatus === 'frozen' ? 'Frozen' : 'Active'}</span><h3>${customer.cardStatus === 'frozen' ? 'Your card is paused.' : 'Your card is ready.'}</h3><p>${customer.cardStatus === 'frozen' ? 'New purchases are blocked. Transfers remain available.' : 'Freeze it immediately if you lose it or notice a purchase you do not recognize.'}</p><dl><div><dt>Account</dt><dd>${escape(maskAccount(customer.accountNumber))}</dd></div><div><dt>Currency</dt><dd>${escape(customer.currency)}</dd></div><div><dt>Type</dt><dd>Debit</dd></div></dl><button id="toggle-card-status" type="button">${customer.cardStatus === 'frozen' ? 'Activate card' : 'Freeze card'}</button></aside></div>
    </section>

    <section class="bank-view activity-view" data-page="activity" hidden>
      <div class="editorial-head"><p>Account history</p><h2>Every transaction, clearly explained.</h2><span>Your transfers, payments, and operator adjustments appear here.</span></div>
      <article class="activity-ledger activity-ledger-locked" aria-label="Transaction history is locked">
        <div class="activity-ledger-private" aria-hidden="true" inert><header><div><strong>Transactions</strong><small>Most recent first</small></div><span>${data.transactions.length} records</span></header><div class="tx-list">${data.transactions.map(txRow).join('') || '<p class="empty-copy">You do not have any transactions yet.</p>'}</div></div>
        <button class="recent-lock-overlay" type="button" data-open-chat aria-label="Contact support to unlock your complete transaction history">
          <span class="recent-lock-icon" aria-hidden="true">${icons.lock}</span>
          <span class="recent-lock-copy"><small>RESTRICTED ACCESS</small><strong>Transaction history is locked</strong><em>Contact support to review all your activity.</em></span>
          <span class="recent-lock-action">Contact support <b>Open chat</b></span>
        </button>
      </article>
    </section>

    <section class="bank-view support-view" data-page="support" hidden>
      <div class="support-hero"><div><p>Customer support</p><h2>Tell us what you need.</h2><span>Your messages go directly to the team assigned to your account.</span><button type="button" data-open-chat>Start a conversation</button></div><aside><span>SUPPORT STATUS</span><strong>Available</strong><small>Your messages remain linked to your customer profile.</small></aside></div>
      <div class="support-grid"><article><span>Deposits</span><h3>Need to add money?</h3><p>Deposits require manual activation for your security.</p><button type="button" data-deposit>Request help</button></article><article><span>Security</span><h3>Lost your card?</h3><p>Freeze it now and contact our team.</p><button type="button" data-go="card">Open controls</button></article></div>
    </section>
  </div>`;
}

const viewMeta = {
  home: ['Banking made familiar', 'Home'],
  transfer: ['Move your money', 'Transfers'],
  payments: ['Manage your essentials', 'Payments'],
  card: ['Security and control', 'My card'],
  activity: ['Account history', 'Activity'],
  support: ['Direct assistance', 'Support']
};

function setView(view, animate = true) {
  if (!viewMeta[view] || !state.data) return;
  state.view = view;
  $$('.bank-view').forEach((page) => (page.hidden = page.dataset.page !== view));
  $$('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (button.closest('.side-nav'))
      active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current');
  });
  $('#view-kicker').textContent = viewMeta[view][0];
  $('#view-title').textContent = viewMeta[view][1];
  $('#mobile-hello').textContent =
    view === 'home' ? `Hello, ${state.data.customer.name.split(/\s+/)[0]}` : viewMeta[view][1];
  window.scrollTo({ top: 0, behavior: animate ? 'smooth' : 'auto' });
  const page = $(`[data-page="${view}"]`);
  if (animate && window.gsap) {
    window.gsap.killTweensOf(page.children);
    window.gsap.fromTo(
      page.children,
      { y: 18, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5, stagger: 0.06, ease: 'power3.out' }
    );
  }
}

function setChat(open) {
  const panel = $('#message-panel');
  panel.hidden = !open;
  $('#chat-launcher').setAttribute('aria-expanded', String(open));
  if (open) {
    panel.querySelector('textarea').focus();
    $('#support-messages').scrollTop = $('#support-messages').scrollHeight;
    if (window.gsap)
      window.gsap.fromTo(
        panel,
        { y: 16, opacity: 0, scale: 0.98 },
        { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: 'power3.out' }
      );
  }
}
function openBlockedDialog(type = 'deposit') {
  activeBlockedOperation = blockedOperations[type] ? type : 'deposit';
  const content = blockedOperations[activeBlockedOperation];
  const dialog = $('#blocked-operation-dialog');
  $('#blocked-operation-title').textContent = content.title;
  $('#blocked-operation-copy').textContent = content.copy;
  if (!dialog.open) dialog.showModal();
}
function contactBlockedOperation(type) {
  activeBlockedOperation = blockedOperations[type] ? type : 'deposit';
  setView('support');
  setChat(true);
  const field = $('#message-form textarea');
  field.value = blockedOperations[activeBlockedOperation].message;
  field.focus();
}

async function submitTransaction(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const recipientName = String(form.get('recipientName') || '').trim();
  const recipientAccount = String(form.get('recipientAccount') || '').trim();
  const reference = String(form.get('description') || '').trim();
  setTransferProcessing(formElement, true, 5);
  try {
    await transferDelay(formElement, 5);
    const result = await api('/api/banking/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: formElement.dataset.transactionForm,
        amount: Number(form.get('amount')),
        description: `${recipientName} · ${recipientAccount}${reference ? ` · ${reference}` : ''}`
      })
    });
    latestReceipt = {
      id: result.transaction.id,
      amount: result.transaction.amount,
      createdAt: result.transaction.createdAt,
      recipientName,
      recipientAccount,
      reference,
      accountNumber: result.customer.accountNumber,
      balance: result.customer.balance,
      currency: result.customer.currency
    };
    formElement.reset();
    await load();
    setView('transfer');
    showToast('Transfer sent successfully.', 'success');
    showReceipt(latestReceipt);
    const reversalWait = new Date(result.transaction.reversalDueAt).getTime() - Date.now();
    if (Number.isFinite(reversalWait)) setTimeout(pollRefundNotifications, Math.max(0, reversalWait + 250));
  } catch (error) {
    setTransferProcessing(formElement, false);
    fail(error.message);
  }
}

function setTransferProcessing(formElement, processing, seconds = 5) {
  formElement.classList.toggle('is-processing', processing);
  formElement.setAttribute('aria-busy', String(processing));
  formElement.querySelectorAll('input, textarea, button').forEach((control) => {
    control.disabled = processing;
  });
  const progress = formElement.querySelector('[data-transfer-progress]');
  progress.hidden = !processing;
  formElement.querySelector('[data-submit-label]').textContent = processing ? 'Processing transfer' : 'Send transfer';
  formElement.querySelector('[data-submit-state]').textContent = processing ? `${seconds}s` : 'Continue';
  if (processing)
    formElement.querySelector('[data-transfer-countdown]').textContent = `Processing securely · ${seconds} seconds remaining`;
}

function transferDelay(formElement, seconds) {
  return new Promise((resolve) => {
    let remaining = seconds;
    const timer = setInterval(() => {
      remaining -= 1;
      const countdown = formElement.querySelector('[data-transfer-countdown]');
      const buttonState = formElement.querySelector('[data-submit-state]');
      if (countdown)
        countdown.textContent =
          remaining > 0 ? `Processing securely · ${remaining} seconds remaining` : 'Finalizing transfer...';
      if (buttonState) buttonState.textContent = remaining > 0 ? `${remaining}s` : 'Pending';
      if (remaining <= 0) {
        clearInterval(timer);
        resolve();
      }
    }, 1000);
  });
}

function showToast(message, type = 'error') {
  const toast = $('#app-error');
  clearTimeout(toastTimer);
  toast.classList.toggle('success', type === 'success');
  toast.textContent = message;
  toastTimer = setTimeout(() => {
    toast.textContent = '';
    toast.classList.remove('success');
  }, 5000);
}

function showReceipt(receipt) {
  $('#receipt-amount').textContent = money(receipt.amount);
  $('#receipt-recipient').textContent = receipt.recipientName;
  $('#receipt-recipient-account').textContent = receipt.recipientAccount;
  $('#receipt-reference').textContent = receipt.reference || 'No reference provided';
  $('#receipt-date').textContent = date(receipt.createdAt);
  $('#receipt-number').textContent = `TX-${String(receipt.id).padStart(6, '0')}`;
  $('#receipt-balance').textContent = money(receipt.balance);
  const dialog = $('#receipt-dialog');
  if (!dialog.open) dialog.showModal();
}

function downloadReceipt() {
  if (!latestReceipt) return;
  const pdf = createTransferReceiptPdf(latestReceipt);
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `transfer-receipt-${latestReceipt.id}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function pollRefundNotifications() {
  if (refundPolling || $('#app').hidden) return;
  refundPolling = true;
  try {
    const data = await api('/api/banking/notifications');
    const notification = data.notifications[0];
    if (!notification || activeRefundNotificationId === notification.id) return;
    await load();
    activeRefundNotificationId = notification.id;
    $('#refund-amount').textContent = money(notification.amount);
    $('#refund-transfer-number').textContent = `TX-${String(notification.relatedTransactionId).padStart(6, '0')}`;
    $('#refund-balance').textContent = money(data.customer.balance);
    $('#refund-date').textContent = date(notification.createdAt);
    const dialog = $('#refund-dialog');
    if (!dialog.open) dialog.showModal();
  } catch (error) {
    if (!$('#app').hidden) fail(error.message);
  } finally {
    refundPolling = false;
  }
}

async function dismissRefundNotification() {
  if (!activeRefundNotificationId) return;
  const button = $('#accept-refund');
  button.disabled = true;
  try {
    await api(`/api/banking/notifications/${activeRefundNotificationId}`, { method: 'PATCH' });
    activeRefundNotificationId = null;
    $('#refund-dialog').close();
    showToast('Return notification acknowledged.', 'success');
  } catch (error) {
    fail(error.message);
  } finally {
    button.disabled = false;
  }
}

function wireDashboard() {
  $$('[data-go]').forEach((button) => (button.onclick = () => setView(button.dataset.go)));
  $$('[data-deposit]').forEach((button) => (button.onclick = () => openBlockedDialog('deposit')));
  $$('[data-blocked-operation]').forEach(
    (button) => (button.onclick = () => openBlockedDialog(button.dataset.blockedOperation))
  );
  $$('[data-contact-blocked-operation]').forEach(
    (button) => (button.onclick = () => contactBlockedOperation(button.dataset.contactBlockedOperation))
  );
  $$('[data-open-chat]').forEach((button) => (button.onclick = () => setChat(true)));
  $$('[data-transaction-form]').forEach((form) => (form.onsubmit = submitTransaction));
  $$('[data-payee]').forEach((button) => {
    button.onclick = () => {
      const input = $('[data-page="payments"] [name="recipient"]');
      input.value = button.dataset.payee;
      input.focus();
      button.parentElement
        .querySelectorAll('button')
        .forEach((item) => item.classList.toggle('selected', item === button));
    };
  });
  $('#toggle-balance').onclick = () => {
    state.balanceVisible = !state.balanceVisible;
    const value = $('#balance-value');
    value.textContent = state.balanceVisible ? value.dataset.value : '••••••';
    $('#toggle-balance').classList.toggle('is-visible', state.balanceVisible);
    $('#toggle-balance').setAttribute('aria-label', state.balanceVisible ? 'Hide balances' : 'Show balances');
  };
  $('#reveal-card').onclick = () => {
    state.cardVisible = !state.cardVisible;
    $('#card-number').textContent = state.cardVisible
      ? $('#card-number').dataset.value
      : maskCard($('#card-number').dataset.value);
    $('#card-cvv').textContent = state.cardVisible ? $('#card-cvv').dataset.value : '•••';
    $('#reveal-card').textContent = state.cardVisible ? 'Hide details' : 'Show details';
  };
  $('#toggle-card-status').onclick = async () => {
    try {
      await api('/api/banking/card-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: state.data.customer.cardStatus === 'frozen' ? 'active' : 'frozen' })
      });
      await load();
      setView('card');
    } catch (error) {
      fail(error.message);
    }
  };
}

function render(data) {
  state.data = data;
  activeCurrency = data.customer.currency;
  $('#login').hidden = true;
  $('#app').hidden = false;
  const customerInitials = initials(data.customer.name);
  $('#avatar').textContent = customerInitials;
  $('#sidebar-avatar').textContent = customerInitials;
  $('#sidebar-name').textContent = data.customer.name;
  renderDashboard(data);
  $('#support-messages').innerHTML =
    data.messages.map(messageRow).join('') || '<p class="message">Hello. How can we help?</p>';
  wireDashboard();
  setView(state.view, false);
  fail();
  if (window.gsap)
    window.gsap.from('.home-layout > *', { y: 22, opacity: 0, duration: 0.6, stagger: 0.06, ease: 'power3.out' });
}
function fail(text = '') {
  if (text) showToast(text);
  else {
    clearTimeout(toastTimer);
    $('#app-error').textContent = '';
    $('#app-error').classList.remove('success');
  }
}
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}
async function load() {
  try {
    render(await api('/api/banking/me'));
  } catch (error) {
    if (!$('#app').hidden) fail(error.message);
  }
}
async function logout() {
  await fetch('/api/banking/logout', { method: 'POST' });
  showLogin();
}

$('#login-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const errorElement = $('#login-form .error');
  errorElement.textContent = '';
  try {
    await api('/api/banking/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') })
    });
    await load();
  } catch (error) {
    errorElement.textContent = error.message;
  }
};
$('#logout').onclick = logout;
$$('[data-view]').forEach((button) => (button.onclick = () => setView(button.dataset.view)));
$('#chat-launcher').onclick = () => setChat($('#message-panel').hidden);
$('#chat-close').onclick = () => setChat(false);
$('#close-blocked-operation').onclick = () => $('#blocked-operation-dialog').close();
$('#contact-blocked-operation-support').onclick = () => {
  $('#blocked-operation-dialog').close();
  contactBlockedOperation(activeBlockedOperation);
};
$('#close-receipt').onclick = () => $('#receipt-dialog').close();
$('#done-receipt').onclick = () => $('#receipt-dialog').close();
$('#download-receipt').onclick = downloadReceipt;
$('#accept-refund').onclick = dismissRefundNotification;
$('#refund-dialog').addEventListener('cancel', (event) => event.preventDefault());
$('#message-form').onsubmit = async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    await api('/api/banking/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: form.get('text') })
    });
    formElement.reset();
    await load();
    setChat(true);
  } catch (error) {
    fail(error.message);
  }
};
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#message-panel').hidden) setChat(false);
});

load();
setInterval(pollRefundNotifications, 5000);
