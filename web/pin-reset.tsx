import {t,LanguageSelect} from './i18n';
import React, {useEffect,useState,type FormEvent} from 'react';
import {api} from './client';

type ResetAccount={person:string;username:string;expiresAt:string};
export type MemberReset=ResetAccount&{token:string};
export function hasPinReset(){return new URLSearchParams(location.search).get('reset')==='1'||new URLSearchParams(location.hash.slice(1)).has('reset');}

export function MemberResetLink({reset}:{reset:MemberReset}){
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 const link=location.origin+'/?reset=1#reset='+encodeURIComponent(reset.token);
 return <section className="editor" aria-live="polite">
  <h2>{reset.person} {t(" 的 PIN 重置链接")}</h2>
  <p>{t("账号：")}{reset.username}{t("。旧 PIN 和已登录会话已失效，请将链接私下发给该成员。")}</p>
  <p>{t("链接只能使用一次，有效期一小时，截止 ")}{new Date(reset.expiresAt).toLocaleString()}{t("。再次生成会使旧链接失效。")}</p>
  <label>{t("重置链接")}<input readOnly value={link} onFocus={e=>e.currentTarget.select()}/></label>
  <button onClick={async()=>{try{await navigator.clipboard.writeText(link);setCopied(true);setError('');}catch{setError(t("无法自动复制，请选中上方链接手动复制。"));}}}>{copied?t("已复制重置链接"):t("复制重置链接")}</button>
  {error&&<p role="alert">{t(error)}</p>}
 </section>;
}

export function PinReset({onDone,signedIn}:{onDone:()=>void;signedIn?:string}){
 const [initialToken]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('reset')||'');
 const [token,setToken]=useState(initialToken),[account,setAccount]=useState<ResetAccount|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(!!initialToken);
 useEffect(()=>{
  if(!initialToken)return;let active=true;
  api('/reset/resolve',{token:initialToken}).then(d=>{if(active)setAccount(d);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[initialToken]);
 async function resolve(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{setAccount(await api('/reset/resolve',{token:token.trim()}));setToken(token.trim());}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=new FormData(e.currentTarget),password=String(form.get('password')||'');
  if(!/^\d{4}$/.test(password)){setError(t("PIN 必须为四位数字"));return;}
  if(password!==form.get('confirm')){setError(t("两次 PIN 不一致"));return;}
  setBusy(true);setError('');
  try{await api('/reset',{token,password});history.replaceState(null,'',location.pathname);onDone();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <main className="container main"><section className="auth-form pin-reset-form">
  <h1>{t("重置 PIN")}</h1>
  {signedIn&&<p className="notice">{t("当前已登录 ")}{signedIn}{t("。完成重置后，此浏览器会切换到下方成员账号。")}</p>}
  {busy&&!account&&<p role="status">{t("正在验证重置链接…")}</p>}
  {account?<><p>{t("正在为 ")}<strong>{account.person}</strong>（{account.username}{t("）设置新 PIN。")}</p>
   <form onSubmit={submit}>
    <label>{t("新的四位 PIN")}<input name="password" type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" required/></label>
    <label>{t("再次输入 PIN")}<input name="confirm" type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" required/></label>
    <button className="primary full" disabled={busy}>{busy?t("正在设置…"):t("设置新 PIN")}</button>
   </form></>:!initialToken&&<form onSubmit={resolve}>
    <label>{t("一次性重置口令")}<input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} required maxLength={200}/></label>
    <button className="primary full" disabled={busy}>{t("验证口令")}</button>
   </form>}
  {error&&<p className="error" role="alert">{t(error)}</p>}
  <a className="text-button button-link" href="/">{t("返回账本")}</a>
 </section></main>;
}
