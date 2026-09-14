/**
 * Page to Markdown.
 *
 * The screenshot is for humans; this is for models. An agent that can only
 * receive a PNG has to run OCR or a vision model to read a page we already
 * had as a DOM, which is slower, lossier and more expensive than just handing
 * it the text.
 *
 * Same philosophy as blocking.js: dependency-free, and it runs in the page.
 * A server-side parser (turndown, readability) is strictly better at edge
 * cases, but it needs the HTML shipped out of the browser first, and by the
 * time we are extracting we already have a fully rendered, consent-swept,
 * ad-collapsed DOM sitting right there. Walking it in place is both cheaper
 * and more accurate than re-parsing a serialisation of it.
 *
 * Reuses the render pipeline exactly as-is, which matters: everything that
 * makes the screenshot correct - the adaptive settle, the consent sweep, the
 * lazy-image scroll - makes the extracted text correct for the same reasons.
 */

/**
 * Built as a string for page.evaluate, like the blocking scripts. Returns
 * { title, url, markdown, text, chars }.
 */
const EXTRACT_BODY = `
  // Never emit these. Script and style are obvious; the rest are page
  // furniture that is noise in a document handed to a model.
  const SKIP = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME',
    'OBJECT', 'EMBED', 'AUDIO', 'VIDEO', 'MAP', 'AREA', 'LINK', 'META',
  ]);

  // Structural landmarks worth dropping wholesale when the page has real
  // content elsewhere. Kept conservative: if removing them would empty the
  // document we keep them, because plenty of sites mark their only content
  // as <aside> or hang it off a <nav>.
  const CHROME_SELECTOR = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]';

  const BLOCK = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIV', 'DL',
    'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
    'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
    'SECTION', 'TABLE', 'UL',
  ]);

  const styleOf = (el) => { try { return getComputedStyle(el); } catch (e) { return null; } };

  const isHidden = (el) => {
    const style = styleOf(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    if (style.opacity === '0') return true;
    return false;
  };

  // An element the browser lays out as a box is visually separated from what
  // follows it, even when the HTML has no whitespace between them.
  // danluu.com writes <d>09/26</d><a ...> with nothing in between and styles
  // <d> as a 4em flex item; read as raw markup that concatenates into
  // "09/26[title]". Reading the computed layout instead is the whole point of
  // extracting inside the page rather than parsing a serialised copy of it.
  const LAID_OUT = /^(block|flex|grid|table|list-item|flow-root|table-cell|inline-block|inline-flex)/;
  const laidOut = (el) => {
    const style = styleOf(el);
    return style ? LAID_OUT.test(style.display) : false;
  };

  // Shadow roots are invisible to innerText and to querySelectorAll, so a page
  // built out of web components extracts as an empty document. Walking into
  // open roots costs nothing and is the difference between a usable result and
  // nothing at all on component-heavy sites. Closed roots are unreachable by
  // design - nothing can be done about those.
  const childNodesOf = (node) => {
    const shadow = node.shadowRoot;
    if (shadow) return [...shadow.childNodes, ...node.childNodes];
    return [...node.childNodes];
  };

  const inline = (s) => s.replace(/\\s+/g, ' ');
  const escapeMd = (s) => s.replace(/([\\\\\`*_\\[\\]])/g, '\\\\$1');

  function walk(node, ctx) {
    if (node.nodeType === 3) return escapeMd(inline(node.nodeValue || ''));
    if (node.nodeType !== 1) return '';

    const tag = node.tagName;
    if (SKIP.has(tag)) return '';
    if (node.dataset && node.dataset.screenshotlineAdCollapsed === '1') return '';
    // Page furniture marked by extract(). Checked here, at every depth -
    // checking only body's direct children left every nested <nav> in place.
    if (node.getAttribute && node.getAttribute('data-screenshotline-hidden') === '1') return '';
    if (isHidden(node)) return '';

    const kids = () => childNodesOf(node).map((n) => walk(n, ctx)).join('');

    switch (tag) {
      case 'BR': return '\\n';
      case 'HR': return '\\n\\n---\\n\\n';
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const level = Number(tag[1]);
        const text = inline(kids()).trim();
        return text ? \`\\n\\n\${'#'.repeat(level)} \${text}\\n\\n\` : '';
      }
      case 'P': {
        const text = kids().trim();
        return text ? \`\\n\\n\${text}\\n\\n\` : '';
      }
      case 'STRONG': case 'B': {
        const text = inline(kids()).trim();
        return text ? \`**\${text}**\` : '';
      }
      case 'EM': case 'I': {
        const text = inline(kids()).trim();
        return text ? \`*\${text}*\` : '';
      }
      case 'CODE': {
        if (node.closest && node.closest('pre')) return node.textContent || '';
        const text = inline(node.textContent || '').trim();
        return text ? \`\\\`\${text}\\\`\` : '';
      }
      case 'PRE': {
        const text = (node.textContent || '').replace(/\\n+$/, '');
        return text ? \`\\n\\n\\\`\\\`\\\`\\n\${text}\\n\\\`\\\`\\\`\\n\\n\` : '';
      }
      case 'BLOCKQUOTE': {
        const text = kids().trim();
        if (!text) return '';
        return '\\n\\n' + text.split('\\n').map((l) => '> ' + l).join('\\n') + '\\n\\n';
      }
      case 'A': {
        const raw = kids();
        if (!raw.trim()) return '';
        let href = node.getAttribute('href') || '';
        try { href = new URL(href, document.baseURI).href; } catch (e) {}
        const flatten = (s) => inline(s.replace(/^#+\\s*/gm, '')).trim();
        if (!href || href.startsWith('javascript:')) return flatten(raw);
        // A link wrapping block content - a card around a headline, which is
        // how most news front pages are built. Emitted naively that becomes
        // "[# Headline](url)", which is neither a link nor a heading. Keep
        // both: hoist the heading level out and put the link inside it.
        const heading = raw.match(/^\\s*(#{1,6})\\s/);
        const text = flatten(raw);
        if (!text) return '';
        if (heading) return \`\\n\\n\${heading[1]} [\${text}](\${href})\\n\\n\`;
        if (raw.includes('\\n')) return \`\\n\\n[\${text}](\${href})\\n\\n\`;
        return \`[\${text}](\${href})\`;
      }
      case 'IMG': {
        const alt = inline(node.getAttribute('alt') || '').trim();
        let src = node.currentSrc || node.getAttribute('src') || '';
        try { src = new URL(src, document.baseURI).href; } catch (e) {}
        if (!src || src.startsWith('data:')) return '';
        return \`![\${escapeMd(alt)}](\${src})\`;
      }
      case 'UL': case 'OL': {
        const ordered = tag === 'OL';
        const items = [];
        let n = Number(node.getAttribute('start') || 1);
        for (const li of childNodesOf(node)) {
          if (li.nodeType !== 1 || li.tagName !== 'LI') continue;
          if (isHidden(li)) continue;
          const body = walk(li, { ...ctx, depth: ctx.depth + 1 }).trim();
          if (!body) continue;
          const marker = ordered ? \`\${n++}. \` : '- ';
          const pad = '  '.repeat(ctx.depth);
          // Continuation lines line up under the marker, so nested lists and
          // multi-line items survive the round trip.
          const indented = body.split('\\n').map((l, i) => (i === 0 ? l : pad + '  ' + l)).join('\\n');
          items.push(pad + marker + indented);
        }
        return items.length ? '\\n\\n' + items.join('\\n') + '\\n\\n' : '';
      }
      case 'TABLE': {
        const rows = [...node.querySelectorAll('tr')].filter((r) => !isHidden(r));
        if (!rows.length) return '';
        const cells = (tr) =>
          [...tr.children]
            .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
            .map((c) => inline(walk(c, ctx)).trim().replace(/\\|/g, '\\\\|'));
        const head = cells(rows[0]);
        if (!head.length) return '';
        const out = ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |'];
        for (const tr of rows.slice(1)) {
          const c = cells(tr);
          if (c.length) out.push('| ' + c.join(' | ') + ' |');
        }
        return '\\n\\n' + out.join('\\n') + '\\n\\n';
      }
      default: {
        const body = kids();
        if (BLOCK.has(tag)) return \`\\n\\n\${body}\\n\\n\`;
        // Unknown element. If the browser gives it a box, give it a space.
        if (body && laidOut(node)) return ' ' + body + ' ';
        return body;
      }
    }
  }

  function extract(options) {
    const root = document.body;
    if (!root) return { title: document.title || '', url: location.href, markdown: '', text: '', chars: 0 };

    // Drop page furniture, but only if something is left afterwards.
    const stripped = [];
    if (options.stripChrome) {
      for (const el of document.querySelectorAll(CHROME_SELECTOR)) {
        stripped.push([el, el.getAttribute('data-screenshotline-hidden')]);
        el.setAttribute('data-screenshotline-hidden', '1');
      }
    }

    const render = () => childNodesOf(root).map((n) => walk(n, { depth: 0 })).join('');

    let md = render();
    if (options.stripChrome && md.replace(/\\s/g, '').length < 200) {
      // Stripping took the page with it. Some sites really do put the article
      // inside <aside>. Fall back to the whole body rather than return a stub.
      for (const [el] of stripped) el.removeAttribute('data-screenshotline-hidden');
      md = childNodesOf(root).map((n) => walk(n, { depth: 0 })).join('');
    }

    md = md
      .replace(/[ \\t]+\\n/g, '\\n')
      .replace(/\\n{3,}/g, '\\n\\n')
      .replace(/^\\s+|\\s+$/g, '');

    if (options.maxChars > 0 && md.length > options.maxChars) {
      md = md.slice(0, options.maxChars) + '\\n\\n[truncated]';
    }

    return {
      title: document.title || '',
      url: location.href,
      markdown: md,
      text: (root.innerText || '').trim(),
      chars: md.length,
    };
  }
`;

/** Build the evaluate payload for a given set of extraction options. */
export function extractScript({ stripChrome = true, maxChars = 0 } = {}) {
  return `(() => {${EXTRACT_BODY}
  return extract(${JSON.stringify({ stripChrome, maxChars })});
})()`;
}

export default { extractScript };
