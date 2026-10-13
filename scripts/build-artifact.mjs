// Builds the claude.ai version's page from the same source as the installed app.
// Usage: node scripts/build-artifact.mjs <out-dir>
// Writes <out-dir>/index.html: the <title>, styles.css inlined and the body markup (claude.ai supplies
// the document head). Publish it with the modules mapped from this folder, and platform.js mapped
// from platform-claude.js; ai.js, device-settings.js, store.js and sw.js are not used there.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) { console.error('Usage: node scripts/build-artifact.mjs <out-dir>'); process.exit(1); }
const html = readFileSync(join(root, 'index.html'), 'utf8');
const start = html.indexOf('<!--BODY-->'), end = html.indexOf('<!--/BODY-->');
if (start < 0 || end < 0) throw new Error('index.html is missing the <!--BODY--> markers');
const body = html.slice(start + '<!--BODY-->'.length, end).trim();
const css = readFileSync(join(root, 'styles.css'), 'utf8');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), `<title>LiftrTrackr</title>\n<style>\n${css}</style>\n<script src="boot-theme.js"></script>\n${body}\n`);
console.log(`wrote ${join(out, 'index.html')}`);
