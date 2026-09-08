import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const menuSpecs = [
  ['retail-accounts', 'Accounts', '/en/retail/accounts', '/en/retail/accounts'],
  ['retail-loans', 'Loans', '/en/retail/loans', '/en/retail/loans'],
  ['retail-cards', 'Cards', '/en/retail/cards', '/en/retail/cards'],
  ['retail-payments', 'Payments', '/en/retail/payments', '/en/retail/payments'],
  ['retail-services', 'Services', '/en/retail/services', '/en/retail/services'],
  ['retail-insurance-pension', 'Insurance & Pension', '/en/retail/insurance-pension', '/en/retail/insurance-pension'],
  ['retail-investment', 'Investment', '/en/retail/investment', '/en/retail/investment'],
  ['sme-accounts', 'Accounts', '/en/sme/accounts', '/en/commercial/accounts'],
  ['sme-cards', 'Cards', '/en/sme/cards', '/en/commercial/cards'],
  ['sme-loans', 'Loans', '/en/sme/loans', '/en/commercial/loans'],
  ['sme-foreign-trade', 'Foreign Trade', '/en/sme/foreign-trade', '/en/commercial/foreign-trade'],
  ['sme-cash-management', 'Cash Management', '/en/sme/cash-management', '/en/commercial/cash-management'],
  ['sme-pos-services', 'POS Services', '/en/sme/pos-services', '/en/commercial/pos-services'],
  ['sme-investment', 'Investment', '/en/sme/investment', '/en/commercial/investment'],
  ['sme-agriculture', 'Agriculture', '/en/sme/agriculture', '/en/commercial/agriculture'],
  ['corporate-accounts', 'Accounts', '/en/corporate/accounts', '/en/corporate/accounts'],
  ['corporate-loans', 'Loans', '/en/corporate/loans', '/en/corporate/loans'],
  ['corporate-foreign-trade', 'Foreign Trade', '/en/corporate/foreign-trade', '/en/corporate/foreign-trade'],
  ['corporate-cards', 'Cards', '/en/corporate/cards', '/en/corporate/cards'],
  ['corporate-cash-management', 'Cash Management', '/en/corporate/cash-management', '/en/corporate/cash-management'],
  ['corporate-investment', 'Investment', '/en/corporate/investment', '/en/corporate/investment'],
  ['corporate-agriculture', 'Agriculture', '/en/corporate/agriculture', '/en/corporate/agriculture']
];
const footerSpecs = [
  [
    'footer-domestic-subsidiaries',
    'Local Subsidiaries',
    '/en/our-bank/about-us/ziraat-finans-group/domestic-subsidiaries',
    '/en/our-bank/about-us/ziraat-finans-group/domestic-subsidiaries',
    'Our Bank',
    '/en/our-bank'
  ],
  [
    'footer-subsidiaries-abroad',
    'Subsidiaries Abroad, Overseas Branches and Representative Offices',
    '/en/our-bank/about-us/ziraat-finans-group/subsidiaries-abroad-overseas-branches-and-representative-offices',
    '/en/our-bank/about-us/ziraat-finans-group/subsidiaries-abroad-overseas-branches-and-representative-offices',
    'Our Bank',
    '/en/our-bank'
  ],
  [
    'footer-announcements',
    'News & Announcements',
    '/en/our-bank/press-room/news-announcements',
    '/en/our-bank/press-room/news-announcements',
    'Our Bank',
    '/en/our-bank'
  ],
  ['footer-calculation-tools', 'Calculation Tools', '/en/calculation-tools', '/en/calculation-tools'],
  ['footer-sitemap', 'Site Map', '/en/sitemap', '/en/sitemap'],
  ['footer-faq', 'FAQ', '/en/faq', '/en/faq'],
  [
    'footer-time-out-account',
    'Time Out Account',
    '/tr/bankamiz/ziraatten-duyurular/duyurular/zamanasimina-ugrayan-mevduat-ve-emanet-hesaplari',
    '/tr/bankamiz/ziraatten-duyurular/duyurular/zamanasimina-ugrayan-mevduat-ve-emanet-hesaplari'
  ],
  [
    'footer-iban',
    'IBAN',
    '/en/calculation-tools/iban',
    '/en/calculation-tools/iban',
    'Calculation Tools',
    '/en/calculation-tools'
  ],
  ['footer-legal-notice', 'Legal Notice', '/en/legal-notice', '/en/legal-notice'],
  ['footer-branches-atms', 'Branches & ATMs', '/en/contact-us/branches-atms', '/en/contact-us/branches-atms'],
  ['footer-contact-form', 'Contact Form', '/en/contact-us/contact-form', '/en/contact-us/contact-form'],
  [
    'footer-personal-data-protection',
    'Personal Data Protection',
    '/en/our-bank/announcements/disclosure-of-protection-of-personal-data',
    '/en/our-bank/announcements/disclosure-of-protection-of-personal-data',
    'Our Bank',
    '/en/our-bank'
  ]
];
const heroSpecs = [
  [
    'hero-western-union',
    'Western Union',
    '/en/retail/services/western-union',
    '/en/retail/services/western-union',
    'Services',
    '/en/retail/services'
  ],
  [
    'hero-ziraat-mobile',
    'Ｚiraat Mobil',
    '/en/digital-banking/mobile-banking/ziraat-mobil',
    '/en/digital-banking/mobile-banking/ziraat-mobil',
    'Digital Banking',
    '/en/digital-banking'
  ],
  [
    'hero-ziraat-mobile-corporate',
    'Ｚiraat Mobile Corporate',
    '/en/digital-banking/mobile-banking/ziraat-mobile-corporate',
    '/en/digital-banking/mobile-banking/ziraat-mobile-corporate',
    'Digital Banking',
    '/en/digital-banking'
  ]
];
const routes = new Map([
  ...menuSpecs.map(([, , officialRoute, localRoute]) => [officialRoute, localRoute]),
  ...footerSpecs.map(([, , officialRoute, localRoute]) => [officialRoute, localRoute]),
  ...heroSpecs.map(([, , officialRoute, localRoute]) => [officialRoute, localRoute]),
  ['/en/product-and-service-fees', '/en/product-and-service-fees'],
  ['/en/our-bank', '/en/our-bank'],
  ['/en/investor-relations', '/en/investor-relations'],
  ['/en/digital-banking', '/en/digital-banking'],
  ['/en/retail', '/en/retail'],
  ['/en/sme', '/en/commercial'],
  ['/en/corporate', '/en/corporate'],
  ['/tr', '/tr']
]);
const localRoutes = new Set(['/en', ...routes.values()]);
function neutralizeExternalLinks(markup) {
  return markup.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = tag.match(/\bhref=(['"])(https?:\/\/[^'"]*)\1/i);
    if (!href) return tag;
    let localHref = '';
    try {
      const parsed = new URL(href[2]);
      if (/^\/(?:en|tr)(?:\/|$)/i.test(parsed.pathname)) localHref = parsed.pathname + parsed.search + parsed.hash;
      else if (/^\/Transactions\//i.test(parsed.pathname)) localHref = '/internet-banking';
    } catch {}
    return tag
      .replace(/\bhref=(['"])https?:\/\/[^'"]*\1/i, `href="${localHref}"`)
      .replace(/\s+target=(['"])_blank\1/gi, '')
      .replace(/\s+rel=(['"])noopener noreferrer\1/gi, '');
  });
}
function neutralizeUnavailableLocalLinks(markup) {
  return markup.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = tag.match(/\bhref=(['"])(\/(?:en|tr)(?:\/[^'"]*)?)\1/i);
    if (!href) return tag;
    const pathname = href[2].split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';
    if (localRoutes.has(pathname)) return tag;
    return tag
      .replace(/\bhref=(['"])\/(?:en|tr)(?:\/[^'"]*)?\1/i, 'href=""')
      .replace(/\s+target=(['"])_blank\1/gi, '')
      .replace(/\s+rel=(['"])noopener noreferrer\1/gi, '');
  });
}
function localize(s) {
  for (const [from, to] of routes) {
    s = s.replaceAll(`href="${from}"`, `href="${to}"`);
    s = s.replaceAll(`href="${to}" target="_blank" rel="noopener noreferrer" target="_blank"`, `href="${to}"`);
    s = s.replaceAll(`href="${to}" target="_blank" rel="noopener noreferrer"`, `href="${to}"`);
    s = s.replaceAll(`href="${to}" target="_blank"`, `href="${to}"`);
  }
  return neutralizeUnavailableLocalLinks(neutralizeExternalLinks(s));
}
let home = localize(await readFile(new URL('public/index.html', root), 'utf8'));
await writeFile(new URL('public/index.html', root), home);
const mobileStart = home.indexOf('<div class="mobile-navigation');
const header =
  home.slice(mobileStart, home.indexOf('<div role="main"', mobileStart)) +
  (home.match(/<header class="header"[\s\S]*?<\/header>/)?.[0] || '');
const footer = home.slice(home.indexOf('<footer class="section'), home.indexOf('</footer>') + 9);
const specs = [
  ['product-and-service-fees', 'Product and Service Fees', '/en/product-and-service-fees'],
  ['our-bank', 'Our Bank', '/en/our-bank'],
  ['investor-relations', 'Investor Relations', '/en/investor-relations'],
  ['digital-banking', 'Digital Banking', '/en/digital-banking'],
  ['retail', 'Retail', '/en/retail'],
  ['commercial', 'Commercial', '/en/commercial'],
  ['corporate', 'Corporate', '/en/corporate']
];
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const localTarget = (u) => (u?.startsWith('/') ? u : '');
function decodeText(s = '') {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#58;/g, ':')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function divInnerAt(raw, start) {
  const openEnd = raw.indexOf('>', start);
  if (openEnd < 0) return '';
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = openEnd + 1;
  let depth = 1;
  for (let match; (match = tags.exec(raw));) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return raw.slice(openEnd + 1, match.index);
  }
  return '';
}
function richField(raw, label) {
  const marker = raw.indexOf(`>${label}</div>`);
  if (marker < 0) return '';
  const start = raw.indexOf('<div', marker + label.length + 7);
  return start < 0 ? '' : divInnerAt(raw, start);
}
function classDiv(raw, className) {
  const match = new RegExp(`<div[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'i').exec(raw);
  return match ? divInnerAt(raw, match.index) : '';
}
function safeRich(s = '') {
  return s
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<menu\b[^>]*>[\s\S]*?<\/menu>/gi, '')
    .replace(/<ie:menuitem\b[^>]*>[\s\S]*?<\/ie:menuitem>/gi, '')
    .replace(/\son\w+=("[^"]*"|'[^']*')/gi, '')
    .replace(/href=("|')javascript:[\s\S]*?\1/gi, 'href="#"');
}
function detailContent(raw, title, sourceRoute) {
  const pageTitle = decodeText(raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || title;
  const image = raw.match(/class="content-img"[\s\S]*?<img[^>]+src="([^"]+)"/i)?.[1];
  const lead = raw.match(/<h2[^>]*class=(?:"|')lead(?:"|')[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  const short = richField(raw, 'ShortDescription');
  let body = richField(raw, 'Page Content');
  if (title === 'Site Map') body = classDiv(raw, 'site-map-box');
  const rich = safeRich(`${short}${body}`);
  if (!decodeText(rich)) {
    const descriptions = {
      'Branches & ATMs':
        'Search current branch and ATM locations, addresses and opening information on the official locator.',
      IBAN: 'IBAN results depend on live bank data and the account information entered by the user.',
      'Time Out Account': 'Current time-out account queries are provided by the bank’s secure online service.'
    };
    return `<section class="reference-service"><h2>${esc(pageTitle)}</h2><p>${esc(descriptions[title] || 'This service depends on current information from the bank.')}</p><a class="btn btn-red" href="${esc(localTarget(sourceRoute))}">OPEN OFFICIAL SERVICE</a></section>`;
  }
  return `<article class="clone-detail">${image ? `<img src="${esc(image)}" alt="">` : ''}<div class="clone-detail-body"><h2>${esc(pageTitle)}</h2>${lead ? `<p class="clone-detail-lead">${safeRich(lead)}</p>` : ''}${rich}</div></article>`;
}
function content(raw, title, sourceRoute) {
  const m = raw.match(/var navigationContainer=({.*?});<\/script>/s);
  if (!m)
    return title === 'Product and Service Fees'
      ? `<section class="fees-local"><h2>Fee information</h2><p>Current fee records are supplied by the bank's online service. This local copy preserves the public page and directs current data to the official source.</p><a class="btn btn-red" href="">VIEW CURRENT FEES</a></section>`
      : detailContent(raw, title, sourceRoute);
  const items = JSON.parse(m[1]).Navigation?.Childs || [];
  return `<div class="clone-card-grid">${items
    .map((x) =>
      x.IsHtml && x.Html
        ? `<article class="clone-card clone-rich">${x.Html}</article>`
        : `<article class="clone-card">${x.Img ? `<img src="${esc(x.Img)}" alt="">` : ''}<div class="clone-card-body"><h2><a href="${esc(localTarget(x.Url))}">${esc(x.Title || title)}</a></h2>${
            x.Childs?.length
              ? `<ul>${x.Childs.slice(0, 8)
                  .map((y) => `<li><a href="${esc(localTarget(y.Url))}">${esc(y.Title)}</a></li>`)
                  .join('')}</ul>`
              : ''
          }</div></article>`
    )
    .join('')}</div>`;
}
async function buildPage(file, title, route, parentTitle, parentRoute = '/en', sourceRoute = route) {
  const raw = await readFile(new URL(`recursos/pages/${file}.html`, root), 'utf8');
  const crumbs = parentTitle ? `<a href="${parentRoute}">${esc(parentTitle)}</a><span> / </span>` : '';
  const sitemap = route === '/en/sitemap';
  const clientScript = sitemap ? '' : '<script type="module" src="/subpages.js"></script>';
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Local Site</title><meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/SiteAssets/css/min/magiclick.min.css"><link rel="stylesheet" href="/clone.css"><link rel="stylesheet" href="/subpages.css">${clientScript}</head><body class="sub-page global en"><a class="clone-skip" href="#ContentSection">Skip to content</a>${header}<main class="global-container zb-w landing"><div class="sub-page-title"><a href="${parentTitle ? parentRoute : '/en'}" class="oval-btn back-btn icon-left-arrow" aria-label="Back"></a><h1>${esc(title)}</h1><div class="breadcrumb"><a href="/en">Main</a><span> / </span>${crumbs}<span>${esc(title)}</span></div></div><div id="ContentSection">${content(raw, title, sourceRoute)}</div></main>${footer}<p class="site-note"></p></body></html>`;
  let output = localize(page);
  if (sitemap)
    output = output
      .replace(/(<a\b[^>]*\bhref=)(["'])[^"']*\2/gi, '$1"/en"')
      .replace(/\s+target=(["'])_blank\1/gi, '')
      .replace(/\s+rel=(["'])noopener noreferrer\1/gi, '');
  const dir = new URL(`public${route}/`, root);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL('index.html', dir), output);
}
for (const [file, title, route] of specs) await buildPage(file, title, route);
for (const [file, title, sourceRoute, route] of menuSpecs) {
  const parent = route.startsWith('/en/retail/')
    ? 'Retail'
    : route.startsWith('/en/commercial/')
      ? 'Commercial'
      : 'Corporate';
  const parentRoute = route.slice(0, route.lastIndexOf('/'));
  await buildPage(file, title, route, parent, parentRoute, sourceRoute);
}
for (const [file, title, sourceRoute, route, parentTitle, parentRoute] of footerSpecs)
  await buildPage(file, title, route, parentTitle, parentRoute, sourceRoute);
for (const [file, title, sourceRoute, route, parentTitle, parentRoute] of heroSpecs)
  await buildPage(file, title, route, parentTitle, parentRoute, sourceRoute);
const tr = await readFile(new URL('recursos/pages/turkish-home.html', root), 'utf8');
const banners = [
  ...tr.matchAll(/<div class="item box-height owl-lazy[^>]*data-src="([^"]+)"[\s\S]*?<h2>([\s\S]*?)<\/h2>/g)
].slice(0, 5);
const trCards = banners
  .map(
    (m, i) =>
      `<article class="tr-banner" style="background-image:url('${m[1]}')"><div>${m[2]}<a href="">Detaylı Bilgi</a></div></article>`
  )
  .join('');
const trDir = new URL('public/tr/', root);
await mkdir(trDir, { recursive: true });
await writeFile(
  new URL('index.html', trDir),
  `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ｚiraat Bankası — Yerel Site</title><meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/SiteAssets/css/min/magiclick.min.css"><link rel="stylesheet" href="/clone.css"><link rel="stylesheet" href="/subpages.css"></head><body class="global"><header class="tr-local-bar"><a href="/en">ENGLISH</a><img src="/SiteAssets/images/logo.png" alt="Educational demo emblem"><a href="/internet-banking">İnternet Şubesi ↗</a></header><main><h1 class="sr-only">T.C. Ｚiraat Bankası A.Ş.</h1><div class="tr-grid">${trCards}</div><section class="tr-local-content"><h2>Ｚiraat Bankası</h2><p>Türkçe ana sayfanın yerel görsel kopyası. İşlem gerektiren bağlantılar resmi web sitesinde açılır.</p></section></main><p class="site-note">Yerel site · Bankacılık işlemi yapılmaz.</p></body></html>`
);
console.log(
  `Built ${8 + menuSpecs.length + footerSpecs.length + heroSpecs.length} additional public routes from saved HTML.`
);
