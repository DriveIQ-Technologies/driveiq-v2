// Before deploying email changes: every image and driveiq.app link used by
// the HTML emails must load. Social links are skipped (they block bots).
//   npm run check:emails
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '..', 'src');
const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
const urls = new Map();
for (const f of files) {
  const html = readFileSync(path.join(dir, f), 'utf8');
  for (const [, url] of html.matchAll(/(?:src|href)="(https:\/\/[^"]+)"/g)) {
    const isImage = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
    if (!isImage && !url.startsWith('https://driveiq.app/')) continue;
    if (!urls.has(url)) urls.set(url, new Set());
    urls.get(url).add(f);
  }
}

let bad = 0;
await Promise.all(
  [...urls].map(async ([url, used]) => {
    let status = 0;
    try {
      status = (await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) })).status;
    } catch {
      status = 0;
    }
    const ok = status >= 200 && status < 300;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${status || 'no response'}  ${url}  (${[...used].join(', ')})`);
  }),
);
console.log(bad ? `\n${bad} broken. Don't deploy email changes until these load.` : '\nAll email images and links load.');
process.exit(bad ? 1 : 0);
