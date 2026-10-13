// Convert a Storyline globalProvideData(...) file to plain JSON by evaluating only its string literal.
const fs = require('fs'), vm = require('vm');
const [src, dst] = process.argv.slice(2);
const raw = fs.readFileSync(src, 'utf8').replace(/^﻿/, '');
const m = raw.match(/^\s*window\.globalProvideData\('([^']+)',\s*('(?:[^'\\]|\\[\s\S])*')\);?\s*$/);
if (!m) throw new Error('unexpected format: ' + src);
const str = vm.runInNewContext(m[2], Object.create(null), { timeout: 2000 });
fs.writeFileSync(dst, JSON.stringify(JSON.parse(str), null, 1));
