import {useSyncExternalStore} from 'react';
let config={siteName:'Lunaeth Bill',taxRateMilliPercent:13000,taxRegion:'ON'};
const listeners=new Set<()=>void>();
export function setSiteConfig(value:Partial<typeof config>){config={...config,...Object.fromEntries(Object.entries(value).filter(([k])=>k in config))};document.title=config.siteName;for(const fn of listeners)fn();}
export function useSiteConfig(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>config);}
export function SiteName(){return <>{useSiteConfig().siteName}</>;}
