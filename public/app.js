import { depositTotal, monthlyPayment } from './calculations.js';
import { getVisitorId, visitorDisplayName } from './visitor-identity.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const dialog = $('#local-dialog');
let previousFocus;
function showDialog(title, content) {
  previousFocus = document.activeElement;
  $('#dialog-title').textContent = title;
  $('#dialog-content').replaceChildren(content);
  dialog.showModal();
}
function paragraph(text) {
  const el = document.createElement('p');
  el.textContent = text;
  return el;
}
function officialLink(label) {
  const el = document.createElement('a');
  el.textContent = label;
  el.href = '';
  return el;
}
$('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  }
});
dialog.addEventListener('close', () => {
  previousFocus?.focus();
});
$$('a[href^="http://"], a[href^="https://"]').forEach((a) => {
  a.href = '';
  a.target = '_self';
  a.removeAttribute('rel');
});

// Carousel: local images, keyboard/touch support, pause, and reduced-motion preference.
const slider = $('.main-slider');
const slides = $$('.owl-carousel>.item', slider);
const controls = document.createElement('div');
controls.className = 'clone-controls';
controls.setAttribute('aria-label', 'Banner controls');
let active = 0;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dots = slides.map((slide, index) => {
  slide.setAttribute('role', 'group');
  slide.setAttribute('aria-label', `Promotion ${index + 1} of ${slides.length}`);
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.className = 'slide-dot';
  dot.setAttribute('aria-label', `Show slide ${index + 1}`);
  dot.addEventListener('click', () => {
    showSlide(index);
    restart();
  });
  controls.append(dot);
  return dot;
});
const pause = document.createElement('button');
pause.type = 'button';
pause.className = 'slide-pause';
function syncPause() {
  pause.textContent = paused ? '▶' : 'Ⅱ';
  pause.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
}
pause.addEventListener('click', () => {
  paused = !paused;
  syncPause();
  restart();
});
syncPause();
controls.append(pause);
$('#owl-controls-1').replaceChildren(controls);
function showSlide(index) {
  active = (index + slides.length) % slides.length;
  slides.forEach((slide, i) => {
    slide.classList.toggle('active', i === active);
    slide.setAttribute('aria-hidden', String(i !== active));
    slide.inert = i !== active;
    dots[i].setAttribute('aria-current', String(i === active));
  });
}
for (const [direction, label, text] of [
  [-1, 'Previous slide', '‹'],
  [1, 'Next slide', '›']
]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `slide-arrow slide-${direction === 1 ? 'next' : 'prev'}`;
  button.setAttribute('aria-label', label);
  button.textContent = text;
  button.addEventListener('click', () => {
    showSlide(active + direction);
    restart();
  });
  slider.append(button);
}
let timer;
function restart() {
  clearInterval(timer);
  if (!paused)
    timer = setInterval(() => {
      if (!document.hidden && !slider.matches(':hover') && !slider.contains(document.activeElement))
        showSlide(active + 1);
    }, 6500);
}
slider.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    showSlide(active + (e.key === 'ArrowRight' ? 1 : -1));
    restart();
  }
});
let touchStart = 0;
slider.addEventListener(
  'touchstart',
  (e) => {
    touchStart = e.changedTouches[0].clientX;
  },
  { passive: true }
);
slider.addEventListener(
  'touchend',
  (e) => {
    const delta = e.changedTouches[0].clientX - touchStart;
    if (Math.abs(delta) > 50) {
      showSlide(active + (delta < 0 ? 1 : -1));
      restart();
    }
  },
  { passive: true }
);
const mobileQuery = matchMedia('(max-width:767px)');
function resizeSlides() {
  slides.forEach(
    (slide) =>
      (slide.style.backgroundImage = `url("${mobileQuery.matches ? slide.dataset.mobileSrc : slide.dataset.src}")`)
  );
}
mobileQuery.addEventListener('change', resizeSlides);
resizeSlides();
showSlide(0);
restart();

// Navigation and the Internet Banking chooser retain links to the official site.
$$('.navigation>ul>li>a').forEach((a) => {
  a.setAttribute('aria-expanded', 'false');
  a.setAttribute('aria-haspopup', 'true');
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const li = a.parentElement;
    const open = !li.classList.contains('open');
    $$('.navigation>ul>li.open').forEach((x) => {
      x.classList.remove('open');
      $('a', x).setAttribute('aria-expanded', 'false');
    });
    li.classList.toggle('open', open);
    a.setAttribute('aria-expanded', String(open));
  });
});
const desktopNavItems = $$('.header .navigation>ul>li');
let desktopNavCloseTimer;
function closeDesktopNav(except) {
  desktopNavItems
    .filter((li) => li !== except)
    .forEach((li) => {
      li.classList.remove('open');
      $(':scope>a', li)?.setAttribute('aria-expanded', 'false');
    });
}
desktopNavItems.forEach((li) => {
  li.addEventListener('pointerenter', () => {
    if (!matchMedia('(min-width:992px)').matches) return;
    clearTimeout(desktopNavCloseTimer);
    closeDesktopNav(li);
    li.classList.add('open');
    $(':scope>a', li)?.setAttribute('aria-expanded', 'true');
  });
  li.addEventListener('pointerleave', () => {
    if (!matchMedia('(min-width:992px)').matches) return;
    clearTimeout(desktopNavCloseTimer);
    desktopNavCloseTimer = setTimeout(() => closeDesktopNav(), 180);
  });
});
document.addEventListener('pointerdown', (e) => {
  if (matchMedia('(min-width:992px)').matches && !e.target.closest('.header .navigation')) closeDesktopNav();
});
const mobileNav = $('.mobile-navigation');
$$('.mobile-nav-btn').forEach((el) => {
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', 'Toggle navigation');
  el.setAttribute('aria-expanded', 'false');
  const toggle = () => {
    const open = mobileNav.classList.toggle('open');
    $$('.mobile-nav-btn').forEach((b) => b.setAttribute('aria-expanded', String(open)));
    document.body.style.overflow = open ? 'hidden' : '';
  };
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', (e) => {
    if (['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      toggle();
    }
  });
});
const banking = $('.internet-branch');
$('a', banking).setAttribute('aria-expanded', 'false');
$('a', banking).addEventListener('click', (e) => {
  e.preventDefault();
  $('a', banking).setAttribute('aria-expanded', String(banking.classList.toggle('open')));
});
$$('.internet-branch .individual-btn, .internet-branch .corporate-btn, .header-bottom .individual-btn').forEach(
  (link) => {
    link.href = '/internet-banking';
    link.target = '_self';
    link.removeAttribute('data-type');
  }
);
$('.search-btn').addEventListener('click', (e) => {
  e.preventDefault();
  $('.search-box-wrapper').classList.add('open');
  $('#searchTxt').focus();
});
$('.search-close').setAttribute('aria-label', 'Close search');
$('.search-close').addEventListener('click', (e) => {
  e.preventDefault();
  $('.search-box-wrapper').classList.remove('open');
  $('.search-btn').focus();
});
const searchItems = [
  ...new Map(
    $$('a[href=""]').map((a) => [
      a.textContent.trim().replace(/\s+/g, ' '),
      { title: a.textContent.trim().replace(/\s+/g, ' '), url: window.location.href }
    ])
  ).values()
].filter((x) => x.title && !x.title.includes('FOR MORE'));
function search(input) {
  const query = input.value.trim();
  const content = document.createElement('div');
  if (query.length < 3)
    content.append(paragraph('Enter at least 3 characters to search the products and services on this page.'));
  else {
    const matches = searchItems.filter((x) => (x.title + ' ' + x.url).toLowerCase().includes(query.toLowerCase()));
    content.append(
      paragraph(
        matches.length
          ? `${matches.length} results for “${query}”. Links open the official website.`
          : `No results for “${query}”. Try accounts, loans, cards, or mobile.`
      )
    );
    const list = document.createElement('ul');
    matches.forEach((x) => {
      const li = document.createElement('li');
      li.append(officialLink(x.title, x.url));
      list.append(li);
    });
    content.append(list);
  }
  showDialog('Search', content);
}
$$('.search-box').forEach((box) => {
  const input = $('input', box);
  input?.setAttribute('aria-label', 'Search products and services');
  $('.search-button', box)?.addEventListener('click', (e) => {
    e.preventDefault();
    search(input);
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      search(input);
    }
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  mobileNav.classList.remove('open');
  document.body.style.overflow = '';
  $$('.mobile-nav-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  $$('.navigation>ul>li.open').forEach((li) => {
    li.classList.remove('open');
    $('a', li).setAttribute('aria-expanded', 'false');
  });
  banking.classList.remove('open');
  $('a', banking).setAttribute('aria-expanded', 'false');
  $('.search-box-wrapper').classList.remove('open');
});

// Snapshot transcribed from the public homepage on 2026-09-03. No live financial API.
const rates = [
  ['AMERICAN DOLLAR', '46.8867', '49.7410'],
  ['EURO', '54.4780', '57.7946'],
  ['A02 GOLD (1000/1000)', '6,679.697262', '7,646.169784'],
  ['G02 SILVER', '99.324171', '113.695194']
];
$('#ZiraatVerileri').innerHTML =
  `<ul class="rates-list">${rates.map(([name, buy, sell]) => `<li class="rate-item"><h3>${name}</h3><div class="rate-columns"><div><small>BANK BUY</small><strong>${buy}</strong></div><div><small>BANK SELL</small><strong>${sell}</strong></div></div></li>`).join('')}</ul><p class="rates-note">Reference snapshot · 03 Sep 2026<br>Local site — rates are not live.</p>`;
$('#PiyasaVerileri').innerHTML =
  '<div class="market-empty"><p>Market information</p><p>Live market data is available on the official Ｚiraat Baank website.</p><a href="">View current market data ↗</a></div>';
function setupTabs(titleSelector, panelsSelector) {
  const links = $$(`${titleSelector} a`);
  const panels = $$(panelsSelector);
  $(titleSelector).setAttribute('role', 'tablist');
  links.forEach((link, index) => {
    link.setAttribute('role', 'tab');
    link.setAttribute('aria-controls', link.dataset.id);
    link.setAttribute('aria-selected', String(index === 0));
    link.tabIndex = index === 0 ? 0 : -1;
    const select = () => {
      links.forEach((a) => {
        a.classList.toggle('active', a === link);
        a.setAttribute('aria-selected', String(a === link));
        a.tabIndex = a === link ? 0 : -1;
      });
      panels.forEach((panel) => {
        panel.style.display = panel.id === link.dataset.id ? 'block' : 'none';
        panel.setAttribute('role', 'tabpanel');
      });
    };
    link.addEventListener('click', (e) => {
      e.preventDefault();
      select();
    });
    link.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const target = links[(index + (e.key === 'ArrowRight' ? 1 : -1) + links.length) % links.length];
        target.click();
        target.focus();
      }
    });
    if (index === 0) select();
  });
}
setupTabs('.tabs-title', '.tabs-content');
setupTabs('.calctabs-title', '.calctabs-content');

// Local calculators use explicit illustrative assumptions, never official live offers.
function rangeFor(selector, inputSelector, max, value, label) {
  const placeholder = $(selector);
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '1';
  range.max = String(max);
  range.value = String(value);
  range.setAttribute('aria-label', label);
  placeholder.replaceWith(range);
  const input = $(inputSelector);
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.inputMode = 'numeric';
  range.addEventListener('input', () => {
    input.value = range.value;
    updateCalculators();
  });
  input.addEventListener('input', () => (range.value = input.value));
}
rangeFor('#MevduatGetirisi .slider-calculate', '#deposit-calc-vade', 730, 32, 'Deposit term in days');
rangeFor('#KrediHesaplama .slider-calculate', '#calc-vade', 120, 12, 'Loan term in months');
const rateInput = document.createElement('input');
rateInput.id = 'm-faiz-orani';
rateInput.type = 'number';
rateInput.min = '0';
rateInput.max = '100';
rateInput.step = '0.1';
rateInput.value = '30';
rateInput.setAttribute('aria-label', 'Annual interest rate');
$('#m-faiz-orani').replaceWith(rateInput);
$('#kredi-tutari').value = '10000';
$('#faiz-orani').value = '0';
$('#faiz-orani').setAttribute('aria-label', 'Monthly interest rate');
$('#ddlCredit').setAttribute('aria-label', 'Loan product');
const depositNote = paragraph('Illustrative estimate · 17.5% withholding · 365-day year.');
depositNote.className = 'calc-note';
$('#MevduatGetirisi .row.mT20').append(depositNote);
const creditNote = paragraph('Illustrative estimate · monthly rate · excludes taxes and fees.');
creditNote.className = 'calc-note';
$('#KrediHesaplama .form-box>.row').append(creditNote);
const parseAmount = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return NaN;
  return Number(trimmed.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
};
const format = (value, currency = 'TL') =>
  value === null || !Number.isFinite(value)
    ? 'Check your inputs'
    : `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
function updateCalculators() {
  const currency = $('#dovizCinsi').value === 'TRY' ? 'TL' : $('#dovizCinsi').value;
  const result = depositTotal(
    parseAmount($('#tutar').value),
    parseAmount(rateInput.value),
    parseAmount($('#deposit-calc-vade').value)
  );
  $('#MevduatGetirisi .total-price').textContent = format(result, currency);
  $('#MevduatGetirisi .input-box i').textContent = currency;
  $('#KrediHesaplama .total-price').textContent = format(
    monthlyPayment(
      parseAmount($('#kredi-tutari').value),
      parseAmount($('#faiz-orani').value),
      parseAmount($('#calc-vade').value)
    )
  );
}
$$('#calc-form-box input, #calc-form-box select').forEach((input) =>
  input.addEventListener('input', updateCalculators)
);
$$('.total-price').forEach((el) => el.setAttribute('aria-live', 'polite'));
updateCalculators();
$('#credit-select').addEventListener('change', () => {
  const maximum = { G11: 36, G8: 48, G4: 120 }[$('#credit-select').value];
  $('#KrediHesaplama input[type="range"]').max = maximum;
  if (Number($('#calc-vade').value) > maximum) $('#calc-vade').value = maximum;
  updateCalculators();
});

// The local locator prepares a selection; real branch locations remain with the bank.
const cities = {
  Istanbul: ['Kadıköy', 'Beşiktaş', 'Fatih', 'Şişli'],
  Ankara: ['Çankaya', 'Altındağ', 'Yenimahalle'],
  Izmir: ['Konak', 'Karşıyaka', 'Bornova'],
  Antalya: ['Muratpaşa', 'Konyaaltı'],
  Bursa: ['Osmangazi', 'Nilüfer']
};
for (const city of Object.keys(cities)) $('#ddlCity').add(new Option(city, city));
$('#ddlCity').addEventListener('change', () => {
  const town = $('#ddlTown');
  town.replaceChildren(new Option('Select Town', '0'));
  town.disabled = !cities[$('#ddlCity').value];
  for (const name of cities[$('#ddlCity').value] || []) town.add(new Option(name, name));
});
function locate() {
  const content = document.createElement('div');
  const city = $('#ddlCity').value;
  const town = $('#ddlTown').value;
  const query = $('#txtMapSearch').value.trim();
  const type = $('#radio-atm').checked ? 'ATM' : 'Branch';
  content.append(
    paragraph([type, city !== '0' ? city : '', town !== '0' ? town : '', query].filter(Boolean).join(' · '))
  );
  content.append(
    paragraph(
      'This local site does not connect to the bank’s branch database. Open the official locator to search current locations and opening hours.'
    )
  );
  content.append(officialLink('Open official Branches & ATMs locator ↗'));
  showDialog('Closest Ｚiraat', content);
}
$$('.map-search-btn,.map-search .icon-search').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    locate();
  })
);
$('#txtMapSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    locate();
  }
});

const cookie = $('.cookie-box');
if (cookie) {
  try {
    cookie.hidden = localStorage.getItem('ziraat-site-cookie-dismissed') === 'true';
  } catch {
    /* Storage may be unavailable in private contexts. */
  }
  $$('a', cookie).forEach((a) => {
    if (a.classList.contains('icon-close') || a.getAttribute('href')?.startsWith('javascript:')) {
      a.href = '#';
      a.setAttribute('aria-label', 'Dismiss cookie notice');
      a.addEventListener('click', (e) => {
        e.preventDefault();
        cookie.hidden = true;
        try {
          localStorage.setItem('ziraat-site-cookie-dismissed', 'true');
        } catch {}
      });
    }
  });
}
const chatPanel = $('#customer-chat');
const chatLog = $('.chat-messages', chatPanel);
const chatError = $('.chat-error', chatPanel);
const visitorId = getVisitorId();
let chatSession = null;
let chatTimer = null;
let lastChatMessage = 0;
try {
  chatSession = JSON.parse(localStorage.getItem('customer-chat-session'));
} catch {
  /* A fresh session will be created. */
}
function showChatError(message = '') {
  chatError.textContent = message;
  chatError.hidden = !message;
}
function renderChatMessage(message) {
  if (chatLog.querySelector(`[data-message-id="${message.id}"]`)) return;
  const bubble = document.createElement('p');
  bubble.className = `chat-bubble ${message.sender}`;
  bubble.dataset.messageId = message.id;
  bubble.textContent = message.body;
  chatLog.append(bubble);
  lastChatMessage = Math.max(lastChatMessage, Number(message.id));
  chatLog.scrollTop = chatLog.scrollHeight;
}
async function ensureChatSession() {
  if (chatSession?.id && chatSession?.token) return chatSession;
  const response = await fetch('/api/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: visitorDisplayName(visitorId) })
  });
  if (!response.ok) throw new Error('The chat could not be started.');
  const data = await response.json();
  chatSession = { id: data.session.id, token: data.token };
  localStorage.setItem('customer-chat-session', JSON.stringify(chatSession));
  return chatSession;
}
async function refreshChat() {
  try {
    const session = await ensureChatSession();
    const response = await fetch(`/api/chat/sessions/${session.id}/messages?after=${lastChatMessage}`, {
      headers: { 'X-Chat-Token': session.token }
    });
    if (response.status === 401) {
      localStorage.removeItem('customer-chat-session');
      chatSession = null;
      lastChatMessage = 0;
      return;
    }
    if (!response.ok) throw new Error('Messages could not be refreshed.');
    for (const message of (await response.json()).messages) renderChatMessage(message);
    showChatError();
  } catch (error) {
    showChatError(error.message);
  }
}
function openChat() {
  chatPanel.hidden = false;
  document.documentElement.classList.add('chat-open');
  $('.chat-launch').setAttribute('aria-expanded', 'true');
  $('#chat-text').focus();
  refreshChat();
  clearInterval(chatTimer);
  chatTimer = setInterval(refreshChat, 3000);
}
function closeChat() {
  chatPanel.hidden = true;
  document.documentElement.classList.remove('chat-open');
  $('.chat-launch').setAttribute('aria-expanded', 'false');
  clearInterval(chatTimer);
  $('.chat-launch').focus();
}
$('.chat-launch').addEventListener('click', () => (chatPanel.hidden ? openChat() : closeChat()));
$('.chat-close').addEventListener('click', closeChat);
$('.chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#chat-text');
  const text = input.value.trim();
  if (!text) return;
  const button = $('button', event.currentTarget);
  button.disabled = true;
  showChatError();
  try {
    const session = await ensureChatSession();
    const response = await fetch(`/api/chat/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chat-Token': session.token },
      body: JSON.stringify({ text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The message could not be sent.');
    renderChatMessage(data.message);
    input.value = '';
  } catch (error) {
    showChatError(error.message);
  } finally {
    button.disabled = false;
    input.focus();
  }
});
$('.zfg-link>h2>a')?.addEventListener('click', (e) => {
  e.preventDefault();
  const links = $('.zfg-link .link-list');
  const open = links.style.display !== 'block';
  links.style.display = open ? 'block' : 'none';
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
