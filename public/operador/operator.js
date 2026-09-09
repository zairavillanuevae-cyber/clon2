const $ = (s) => document.querySelector(s);
const state = {
  customers: [],
  selected: null,
  selectedConversation: null,
  currency: 'USD',
  view: 'customers',
  conversations: []
};
let conversationTimer = null;
const money = (n, currency = state.currency) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
const date = (v) =>
  new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(v)
  );
const escape = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]
  );
const visitorName = (session) =>
  session.name && session.name !== 'Visitor'
    ? session.name
    : `Visitor ${session.id.replaceAll('-', '').slice(0, 6).toUpperCase()}`;
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
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function fail(text = '') {
  $('#operator-error').textContent = text;
}
function showLogin() {
  clearInterval(conversationTimer);
  $('#operator-view').hidden = true;
  $('#login-view').hidden = false;
}
function showPanel() {
  $('#login-view').hidden = true;
  $('#operator-view').hidden = false;
  setView('customers');
  loadCustomers();
}
function setView(view) {
  state.view = view;
  $('#customers-view').hidden = view !== 'customers';
  $('#messages-view').hidden = view !== 'messages';
  $('#customers-nav').classList.toggle('active', view === 'customers');
  $('#messages-nav').classList.toggle('active', view === 'messages');
  $('#workspace-title').textContent = view === 'customers' ? 'Customers and transactions' : 'All conversations';
  clearInterval(conversationTimer);
  if (view === 'messages') {
    loadConversations(true);
    conversationTimer = setInterval(() => loadConversations(false), 5000);
  }
}
function renderCustomers() {
  const list = $('#customer-list');
  list.replaceChildren();
  $('#customer-count').textContent = `${state.customers.length} record${state.customers.length === 1 ? '' : 's'}`;
  state.customers.forEach((customer) => {
    const button = document.createElement('button');
    button.className = `customer-item${state.selected === customer.id ? ' active' : ''}`;
    button.innerHTML = `<strong>${escape(customer.name)}</strong><span>${escape(customer.accountNumber)}</span><small>${money(customer.balance, customer.currency)}</small>`;
    button.onclick = () => selectCustomer(customer.id);
    list.append(button);
  });
}
async function loadCustomers() {
  try {
    const data = await api('/api/operator/customers');
    state.customers = data.customers;
    renderCustomers();
    if (!state.selected && state.customers[0]) await selectCustomer(state.customers[0].id);
    else if (state.selected) await selectCustomer(state.selected);
    fail();
  } catch (e) {
    fail(e.message);
  }
}
function txRow(tx) {
  const debit = ['withdrawal', 'debit'].includes(tx.type);
  const actor = tx.actor === 'operator' ? 'Operator' : tx.actor === 'customer' ? 'Customer' : 'System';
  const meta = tx.showDate === false ? actor : `${date(tx.createdAt)} · ${actor}`;
  return `<article class="tx ${escape(tx.type)}"><span class="tx-mark">${debit ? '−' : '+'}</span><div><p>${escape(tx.description)}</p><small>${meta}</small></div><strong>${debit ? '−' : '+'}${money(tx.amount)}</strong></article>`;
}
function messageRow(message) {
  return `<p class="message ${escape(message.sender)}">${escape(message.body)}<time>${date(message.createdAt)}</time></p>`;
}
function maskCard(value) {
  return `•••• •••• •••• ${String(value || '')
    .replace(/\s/g, '')
    .slice(-4)}`;
}
function formatCardNumber(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 16)
    .replace(/(.{4})(?=.)/g, '$1 ');
}
async function selectCustomer(id) {
  state.selected = id;
  renderCustomers();
  try {
    const data = await api(`/api/operator/customers/${id}`);
    state.currency = data.customer.currency;
    const withdrawals = data.transactions.filter((x) => x.type === 'withdrawal');
    $('#detail').innerHTML =
      `<div class="customer-head"><div><h2>${escape(data.customer.name)}</h2><p>${escape(data.customer.username)} · ${escape(data.customer.accountNumber)}</p></div><div class="account-chip"><span>${money(data.customer.balance)}</span><small>Available balance</small></div></div><div class="metrics"><div class="metric"><small>Current balance</small><strong>${money(data.customer.balance)}</strong></div><div class="metric"><small>Transactions</small><strong>${data.transactions.length}</strong></div><div class="metric"><small>Withdrawals</small><strong>${withdrawals.length}</strong></div></div><section class="banking-identifiers"><div><small>Demo account / IBAN</small><strong>${escape(data.customer.accountNumber)}</strong></div><div class="card-number-field"><div class="card-number-display"><small>Demo card</small><strong>${escape(maskCard(data.customer.cardNumber))}</strong><button id="edit-card-number" type="button">Edit number</button></div><form id="card-number-form" hidden><label for="card-number-input">Card number</label><input id="card-number-input" name="cardNumber" value="${escape(data.customer.cardNumber)}" inputmode="numeric" autocomplete="off" maxlength="19" pattern="[0-9]{4}( [0-9]{4}){3}" required><div><button class="save-card-number" type="submit">Save</button><button id="cancel-card-number" type="button">Cancel</button></div></form></div><div><small>Demo validity · code</small><strong>${escape(data.customer.cardExpiry)} · ${escape(data.customer.cardCvv)}</strong></div><button id="operator-card-status" type="button">${data.customer.cardStatus === 'frozen' ? 'Unfreeze card' : 'Freeze card'}</button></section><div class="detail-grid account-detail-grid"><section class="block"><h3>Recent activity</h3><div class="transaction-list">${data.transactions.map(txRow).join('') || '<p>No transactions yet.</p>'}</div></section><aside class="block actions"><h3>Adjust balance</h3><form id="balance-form"><div class="segmented"><label><input type="radio" name="type" value="credit" checked>Credit</label><label><input type="radio" name="type" value="debit">Debit</label></div><input name="amount" type="number" min="0.01" step="0.01" placeholder="Amount in ${escape(data.customer.currency)}" required><textarea name="description" maxlength="180" rows="2" placeholder="Adjustment reason"></textarea><fieldset class="date-options"><legend>Date and time</legend><label><input type="radio" name="dateMode" value="hidden" checked><span><strong>Hide date</strong><small>Do not show a date or time</small></span></label><label><input type="radio" name="dateMode" value="manual"><span><strong>Set manually</strong><small>Choose the date and time</small></span></label></fieldset><label class="manual-date" hidden><span>Transaction date and time</span><input name="createdAt" type="datetime-local" step="60"></label><button class="primary" type="submit">Apply transaction</button></form></aside></div>`;
    wireForms();
    fail();
  } catch (e) {
    fail(e.message);
  }
}
async function deleteSelectedCustomer() {
  const customer = state.customers.find((item) => item.id === state.selected);
  if (!customer || !window.confirm(`Delete ${customer.name}? This customer will no longer be able to sign in.`)) return;
  try {
    await api(`/api/operator/customers/${customer.id}`, { method: 'DELETE' });
    state.selected = null;
    state.currency = 'USD';
    $('#detail').innerHTML =
      '<div class="empty-state"><span>OPERATIONS</span><h2>Select a customer</h2><p>Review balances and withdrawals, and communicate from one workspace.</p></div>';
    await loadCustomers();
  } catch (e) {
    fail(e.message);
  }
}
function wireForms() {
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'delete-customer';
  deleteButton.textContent = 'Delete customer';
  deleteButton.onclick = deleteSelectedCustomer;
  $('.account-chip').append(deleteButton);
  const cardNumberDisplay = $('.card-number-display');
  const cardNumberForm = $('#card-number-form');
  const cardNumberInput = $('#card-number-input');
  $('#edit-card-number').onclick = () => {
    cardNumberDisplay.hidden = true;
    cardNumberForm.hidden = false;
    cardNumberInput.focus();
    cardNumberInput.select();
  };
  $('#cancel-card-number').onclick = () => {
    cardNumberInput.value = cardNumberInput.defaultValue;
    cardNumberForm.hidden = true;
    cardNumberDisplay.hidden = false;
    fail();
  };
  cardNumberInput.oninput = () => {
    cardNumberInput.value = formatCardNumber(cardNumberInput.value);
  };
  cardNumberForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/operator/customers/${state.selected}/card-number`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardNumber: cardNumberInput.value })
      });
      await loadCustomers();
    } catch (e) {
      fail(e.message);
      cardNumberInput.focus();
    }
  };
  $('#operator-card-status').onclick = async () => {
    const current = state.customers.find((item) => item.id === state.selected);
    await api(`/api/operator/customers/${state.selected}/card-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: current?.cardStatus === 'frozen' ? 'active' : 'frozen' })
    });
    await loadCustomers();
  };
  const balanceForm = $('#balance-form');
  const manualDate = balanceForm.elements.createdAt;
  const manualDateLabel = manualDate.closest('.manual-date');
  const syncDateMode = () => {
    const isManual = balanceForm.elements.dateMode.value === 'manual';
    manualDateLabel.hidden = !isManual;
    manualDate.required = isManual;
    if (isManual && !manualDate.value) {
      const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
      manualDate.value = localNow.toISOString().slice(0, 16);
    }
  };
  balanceForm.querySelectorAll('[name="dateMode"]').forEach((input) => input.addEventListener('change', syncDateMode));
  balanceForm.onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const dateMode = form.get('dateMode');
      const createdAt = dateMode === 'manual' ? new Date(form.get('createdAt')).toISOString() : undefined;
      await api(`/api/operator/customers/${state.selected}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.get('type'),
          amount: Number(form.get('amount')),
          description: form.get('description'),
          dateMode,
          createdAt
        })
      });
      await loadCustomers();
    } catch (e) {
      fail(e.message);
    }
  };
}
async function loadConversations(openSelected = true) {
  if (state.view !== 'messages') return;
  try {
    const [customerData, visitorData] = await Promise.all([
      api('/api/operator/customers'),
      api('/api/operator/sessions')
    ]);
    state.customers = customerData.customers;
    const bankingConversations = await Promise.all(
      state.customers.map(async (customer) => {
        const detail = await api(`/api/operator/customers/${customer.id}`);
        const last = detail.messages.at(-1);
        return {
          id: customer.id,
          kind: 'banking',
          name: customer.name,
          meta: `${customer.username} · Banking customer`,
          lastMessage: last?.body || 'No messages yet',
          updatedAt: last?.createdAt || customer.createdAt
        };
      })
    );
    const visitorConversations = visitorData.sessions.map((session) => ({
      id: session.id,
      kind: 'visitor',
      name: visitorName(session),
      meta: `Landing chat · ${session.status === 'open' ? 'Open' : 'Closed'}`,
      lastMessage: session.lastMessage || 'New website conversation',
      updatedAt: session.updatedAt,
      status: session.status
    }));
    state.conversations = [...visitorConversations, ...bankingConversations].sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
    renderConversationList();
    if (
      openSelected &&
      state.selectedConversation &&
      state.conversations.some(
        (item) => item.id === state.selectedConversation.id && item.kind === state.selectedConversation.kind
      )
    ) {
      await openConversation(state.selectedConversation.kind, state.selectedConversation.id);
    }
    fail();
  } catch (e) {
    fail(e.message);
  }
}
function renderConversationList() {
  const list = $('#conversation-list');
  $('#conversation-count').textContent =
    `${state.conversations.length} conversation${state.conversations.length === 1 ? '' : 's'}`;
  list.innerHTML = state.conversations
    .map((conversation) => {
      const selected =
        state.selectedConversation?.id === conversation.id && state.selectedConversation?.kind === conversation.kind;
      return `<button class="conversation-item${selected ? ' active' : ''}" type="button" data-conversation-id="${escape(conversation.id)}" data-conversation-kind="${escape(conversation.kind)}"><span class="conversation-avatar ${escape(conversation.kind)}">${escape(
        conversation.name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join('')
          .toUpperCase()
      )}</span><span class="conversation-copy"><strong>${escape(conversation.name)}</strong><small>${escape(conversation.lastMessage)}</small><em>${escape(conversation.meta)}</em></span><time>${date(conversation.updatedAt)}</time></button>`;
    })
    .join('');
  list.querySelectorAll('[data-conversation-id]').forEach((button) => {
    button.onclick = () => openConversation(button.dataset.conversationKind, button.dataset.conversationId);
  });
}
async function openConversation(kind, id) {
  state.selectedConversation = { kind, id };
  renderConversationList();
  try {
    const banking = kind === 'banking';
    const data = banking
      ? await api(`/api/operator/customers/${id}`)
      : await api(`/api/operator/sessions/${id}/messages`);
    const name = banking ? data.customer.name : visitorName(data.session);
    const subtitle = banking
      ? `${data.customer.username} · ${data.customer.accountNumber}`
      : `Landing page visitor · ${data.session.status === 'open' ? 'Open conversation' : 'Closed conversation'}`;
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
    $('#conversation-detail').innerHTML = `<header class="conversation-head"><div class="conversation-avatar">${escape(
      initials
    )}</div><div><h2>${escape(name)}</h2><p>${escape(subtitle)}</p></div><span class="conversation-source ${escape(kind)}">${banking ? 'Banking' : 'Website'}</span></header><div class="message-thread" id="operator-message-thread">${data.messages.map(messageRow).join('') || '<div class="thread-empty"><strong>No messages yet</strong><span>Start the conversation here.</span></div>'}</div><form class="reply-form" id="reply-form"><textarea name="text" maxlength="2000" rows="2" placeholder="Write a reply…" aria-label="Reply to conversation" required></textarea><button type="submit">Send reply <span aria-hidden="true">↗</span></button></form>`;
    const thread = $('#operator-message-thread');
    thread.scrollTop = thread.scrollHeight;
    $('#reply-form').onsubmit = async (event) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      try {
        const endpoint = banking ? `/api/operator/customers/${id}/messages` : `/api/operator/sessions/${id}/messages`;
        await api(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: form.get('text') })
        });
        formElement.reset();
        await openConversation(kind, id);
        await loadConversations(false);
      } catch (e) {
        fail(e.message);
      }
    };
  } catch (e) {
    fail(e.message);
  }
}
const customerDialog = $('#customer-dialog');
function closeCustomerDialog() {
  customerDialog.close();
  $('#customer-form-error').textContent = '';
}
$('#open-customer-dialog').onclick = () => {
  customerDialog.showModal();
  if (!$('#customer-form [name="accountNumber"]').value) generateBankingDetails();
  $('#customer-form [name="name"]').focus();
};
$('#close-customer-dialog').onclick = closeCustomerDialog;
$('#cancel-customer').onclick = closeCustomerDialog;
customerDialog.addEventListener('click', (event) => {
  if (event.target === customerDialog) closeCustomerDialog();
});
$('#customer-form').onsubmit = async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const formError = $('#customer-form-error');
  formError.textContent = '';
  try {
    const data = await api('/api/operator/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        username: form.get('username'),
        password: form.get('password'),
        openingBalance: Number(form.get('openingBalance')),
        currency: form.get('currency'),
        accountNumber: form.get('accountNumber')
      })
    });
    formElement.reset();
    closeCustomerDialog();
    state.selected = data.customer.id;
    await loadCustomers();
  } catch (e) {
    formError.textContent = e.message;
  }
};
function generateBankingDetails() {
  const digits = (count) => Array.from(crypto.getRandomValues(new Uint8Array(count)), (value) => value % 10).join('');
  const groups = (value) => value.match(/.{1,4}/g).join(' ');
  const form = $('#customer-form');
  form.elements.accountNumber.value = `TR${digits(2)} ${groups(digits(20))}`;
}
$('#generate-banking-details').onclick = generateBankingDetails;
$('#login-form').onsubmit = async (event) => {
  event.preventDefault();
  const error = $('.form-error');
  error.textContent = '';
  try {
    await api('/api/operator/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: $('#operator-key').value })
    });
    $('#operator-key').value = '';
    showPanel();
  } catch (e) {
    error.textContent = e.message;
  }
};
$('#logout').onclick = async () => {
  await fetch('/api/operator/logout', { method: 'POST' });
  showLogin();
};
$('#refresh').onclick = loadCustomers;
$('#customers-nav').onclick = () => setView('customers');
$('#messages-nav').onclick = () => setView('messages');
$('#refresh-messages').onclick = loadConversations;
api('/api/operator/customers').then(showPanel).catch(showLogin);
