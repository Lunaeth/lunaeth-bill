import {execFileSync} from 'node:child_process';
import {readFileSync,statSync} from 'node:fs';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.length)throw new Error('No tracked files to scan');
const allowed=/^(src\/|server\/|web\/|public\/favicon\.svg$|tests\/|scripts\/|docs\/|\.github\/workflows\/|\.gitignore$|\.env\.example$|README\.md$|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|tsconfig(\.app)?\.json$|vite\.config\.ts$|index\.html$)/;
const denied=/(^|\/)(data|backups|qa|fixtures|source-receipts|reference-only|node_modules|web-dist|dist)(\/|$)|\.sqlite|\.private\.|\.(key|pem|pfx|p12|jpg|jpeg|png|pdf|zip|gz)$/i;
const signatures=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[pousr]_[A-Za-z0-9]{30,}\b/,/\bgithub_pat_[A-Za-z0-9_]{30,}\b/,/\bAIza[A-Za-z0-9_-]{30,}\b/,/\bsk-(?:ant-)?[A-Za-z0-9_-]{35,}\b/];
const bad=[];
for(const file of files){if(!allowed.test(file)||denied.test(file)||(file.startsWith('.env')&&file!=='.env.example')){bad.push(file+': excluded path');continue;}if(statSync(file).size>2*1024*1024){bad.push(file+': unexpected large file');continue;}const text=readFileSync(file,'utf8');if(signatures.some(re=>re.test(text)))bad.push(file+': possible credential');}
if(bad.length)throw new Error('Privacy check failed:\n'+bad.join('\n'));
console.log(`Privacy check passed for ${files.length} tracked source files.`);
