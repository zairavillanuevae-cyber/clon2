import { readFile, writeFile, mkdir, stat, copyFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('recursos/original.html', root), 'utf8');
let body = source.slice(source.indexOf('<div class="mobile-navigation'), source.indexOf('</footer>') + 9);
body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
body = body.replace(/<div class="homepage-chatbot">[\s\S]*?(?=<div style="display:none;">)/, '');
body = body.replace(/\s+on\w+="[^"]*"/g, '');
body = body.replace(/<input\b[^>]*type="hidden"[^>]*>/gi, '');
body = body.replace(/href="(\/en[^"#]*|\/tr[^"#]*)"/g, (_, url) => `href="${url}"`);
body = body.replace(/href="javascript:;"/g, 'href="#"');
body = body.replace(/class="langUrl" href="#"/g, 'class="langUrl" href="/tr"');
body = body.replace(/href="#" class="langUrl"/g, 'href="/tr" class="langUrl"');
body = body.replace(
  /<div class="item box-height owl-lazy default"/,
  '<div class="item box-height owl-lazy default active"'
);
body = body.replace(/data-src="(\/en\/Banners\/[^"]+)"/g, 'data-src="$1" style="background-image:url(\'$1\')"');
body = body.replace(/(<img[^>]+)src="\/SiteAssets\/images\/transparent.png" data-src="([^"]+)"/g, '$1src="$2"');
body = body.replace(/alt="Ｚiraat Bankası Logosu"/g, 'alt="Educational demo emblem"');
body = body.replace(/(id="home-icon-[^"]+">)/g, '$1<span class="animation" aria-hidden="true"><span></span></span>');
body += '</div></div>';
const cookie = (source.match(/<div class="cookie-box[\s\S]*?<\/div>/)?.[0] || '').replace(
  /href="(\/tr[^"]+)"/g,
  'href="$1"'
);
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
const html = neutralizeExternalLinks(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ｚiraat Baank — Local Site</title><meta name="description" content="Local visual reproduction of the public Ｚiraat Baank English homepage.">
<meta name="robots" content="noindex,nofollow"><link rel="icon" href="/SiteAssets/images/favicon.ico">
<link rel="stylesheet" href="/SiteAssets/css/min/magiclick.min.css"><link rel="stylesheet" href="/clone.css">
<script type="module" src="/app.js"></script></head><body class="home-page global en">
<a class="clone-skip" href="#main-box">Skip to content</a>
${body}
<p class="site-note">Local site · Unaffiliated reproduction · No banking transactions. Product links open the official website.</p>
${cookie}
<button class="chat-launch" type="button" aria-label="Abrir chat" aria-expanded="false" aria-controls="customer-chat"><span class="icon-comment" aria-hidden="true"></span></button>
<section class="customer-chat" id="customer-chat" aria-label="Support chat" hidden>
  <header><div><strong>Online support</strong><small>An operator will reply here</small></div><button class="chat-close" type="button" aria-label="Close chat">×</button></header>
  <div class="chat-messages" role="log" aria-live="polite"><p class="chat-welcome">Hello, how can we help you?</p></div>
  <p class="chat-error" role="alert" hidden></p>
  <form class="chat-form"><label class="sr-only" for="chat-text">Message</label><textarea id="chat-text" maxlength="2000" rows="2" placeholder="Write your message…" required></textarea><button type="submit">Send</button></form>
</section>
<dialog id="local-dialog" aria-labelledby="dialog-title"><button class="dialog-close" aria-label="Close dialog">×</button><h2 id="dialog-title"></h2><div id="dialog-content"></div></dialog>
</body></html>`);
await mkdir(new URL('public/', root), { recursive: true });
await mkdir(new URL('public/vendor/', root), { recursive: true });
await copyFile(new URL('node_modules/gsap/dist/gsap.min.js', root), new URL('public/vendor/gsap.min.js', root));
await writeFile(new URL('public/index.html', root), html);
const refs = [...html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)]
  .map((m) => m[1])
  .filter((p) => /\.[a-z0-9]+(?:\?|$)/i.test(p));
for (const ref of new Set(refs)) await stat(new URL('public' + ref, root));
console.log('Built public/index.html from recursos/original.html. Local HTML assets verified.');
