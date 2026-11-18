// Links for the deck's buttons: the Browser button's address and the shortcut keys
// (a website, a program or file, or a folder). Pure functions, tested by test/links-test.js.
// (Started life as Comm Tower 1's dial rules; the dial was removed in v1.38.)
const MAX_SHORTCUTS = 5;

const WEB = /^https?:\/\/[^\s]+$/i;
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/[^\s]*)?$/i;
const ABS = /^([a-zA-Z]:[\\/]|\\\\|\/)/;
const RUNNABLE = /\.(exe|lnk|bat|cmd|msi|url|appref-ms)$/i;

function cleanUrl(text) {
  const t = String(text || '').trim();
  if (WEB.test(t)) return t;
  if (DOMAIN.test(t) && !RUNNABLE.test(t)) return `https://${t}`;
  return '';
}

function normalizeShortcut(input) {
  let target = String((input && input.target) || '').trim().replace(/^"(.*)"$/, '$1').trim();
  let name = String((input && input.name) || '').trim();
  if (!target) return { ok: false, error: 'Paste a website address, or pick a program or folder.' };
  if (target.length > 400) return { ok: false, error: 'That address is too long.' };
  let kind = '';
  const url = cleanUrl(target);
  if (url) { kind = 'web'; target = url; }
  else if (/^[a-z][a-z0-9+.-]*:(?![\\/])/i.test(target) || /^[a-z][a-z0-9+.-]{1,}:\/\//i.test(target)) return { ok: false, error: 'Only web addresses (http or https), programs and folders can be shortcuts.' };
  else if (ABS.test(target)) kind = /\.[a-z0-9-]{1,10}$/i.test(target) ? 'app' : 'folder';
  else return { ok: false, error: 'Use a full web address, or pick the program or folder with the buttons.' };
  if (!name) {
    if (kind === 'web') { try { name = new URL(target).hostname.replace(/^www\./, '').split('.')[0]; } catch { name = 'Site'; } }
    else name = target.replace(/[\\/]+$/, '').split(/[\\/]/).pop().replace(/\.[a-z0-9-]{1,10}$/i, '') || 'Shortcut';
  }
  return { ok: true, kind, target, name: name.slice(0, 18) };
}

function cleanShortcuts(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== 'object') continue;
    const n = normalizeShortcut(s);
    if (n.ok && s.id && !out.some((o) => o.id === s.id)) out.push({ id: String(s.id), name: n.name, kind: n.kind, target: n.target });
    if (out.length >= MAX_SHORTCUTS) break;
  }
  return out;
}

module.exports = { MAX_SHORTCUTS, cleanUrl, normalizeShortcut, cleanShortcuts };
