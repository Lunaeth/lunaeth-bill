import {useState} from 'react';
import {api} from './client';
import {t} from './i18n';
export function MemberEditor({person,address,onSaved}:{person:{id:string;displayName:string};address:string;onSaved:()=>Promise<void>}){
 const [editing,setEditing]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <><button onClick={()=>setEditing(!editing)}>{t(editing?'取消':'编辑')}</button>{editing&&<form className="member-edit-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');try{await api('/members/'+person.id,{displayName:f.get('name'),emtAddress:f.get('address')},'PUT');await onSaved();setEditing(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label>{t('成员姓名')}<input name="name" defaultValue={person.displayName} required maxLength={80}/></label><label>{t('E-Transfer 地址')}<input name="address" defaultValue={address} maxLength={254}/></label>{error&&<p className="error">{t(error)}</p>}<button className="primary" disabled={busy}>{t('保存成员')}</button></form>}</>;
}
