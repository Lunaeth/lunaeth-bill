import {useSyncExternalStore} from 'react';
import zhTW from './locales/zh-TW.json';
import en from './locales/en-CA.json';
export type Language='zh-CN'|'zh-TW'|'en-CA';
let language:Language='zh-CN';try{const saved=localStorage.getItem('bill-language');if(['zh-CN','zh-TW','en-CA'].includes(saved||''))language=saved as Language;}catch{}
const traditional=zhTW as Record<string,string>,listeners=new Set<()=>void>();
const messages=en as Record<string,string>;
export function t(text:string|undefined,values:unknown[]=[]):string{if(!text)return '';let value=language==='en-CA'?(messages[text]??text):language==='zh-TW'?(traditional[text]??text):text;return value.replace(/\{(\d+)\}/g,(match,index)=>index in values?String(values[Number(index)]??''):match);}
export function setLanguage(value:Language){language=value;try{localStorage.setItem('bill-language',value);}catch{}document.documentElement.lang=value;for(const fn of listeners)fn();}
export function useLanguage(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>language);}
export function LanguageSelect(){const value=useLanguage();return <select className="language-select" aria-label="Language / 语言" value={value} onChange={e=>setLanguage(e.target.value as Language)}><option value="zh-CN">简中</option><option value="zh-TW">繁中</option><option value="en-CA">English</option></select>;}
document.documentElement.lang=language;
