"use client";
import { useState } from "react";
import type { AccountView } from "@/lib/personal-finance/accounts";
import { displayMoney } from "@/lib/personal-finance/accounts";

export default function AccountCard({account,isDefault,disabled,onManage}:{account:AccountView;isDefault:boolean;disabled:boolean;
  onManage:(account:AccountView,operation:string,fields?:Record<string,unknown>)=>void}) {
  const [history,setHistory]=useState<{id:string;kind:string;amount_minor:string;effective_date:string}[]>([]);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [historyBusy,setHistoryBusy]=useState(false);
  const [error,setError]=useState("");
  async function showHistory(){
    setHistoryBusy(true);setError("");
    try{
      const response=await fetch(`/api/personal/accounts/${account.id}/postings`,{cache:"no-store"});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"Tarix olinmadi.");
      setHistory(body.postings);setHistoryOpen(true);
    }catch(e){setError(e instanceof Error?e.message:"Tarix olinmadi.");}
    finally{setHistoryBusy(false);}
  }
  return <article className="personal-card"><h2>{account.name}</h2>
    <p className="personal-balance">{displayMoney(account.balanceMinor,account.scale)} <small>{account.currencyCode}</small></p>
    <p>{account.status==="archived"?"Arxiv":isDefault?"Asosiy":"Faol"}{!account.includeInTotal&&" · Jamiga kirmaydi"}</p>
    <details><summary>Boshqarish</summary>
      <form key={account.version} onSubmit={event=>{
        event.preventDefault();const values=new FormData(event.currentTarget);
        onManage(account,"update",{name:values.get("name"),icon:values.get("icon"),color:values.get("color"),includeInTotal:values.get("include")==="on"});
      }}><fieldset disabled={disabled||account.status==="archived"}>
        <div className="field"><label htmlFor={`name-${account.id}`}>Hisob nomi</label><input id={`name-${account.id}`} name="name" minLength={2} maxLength={80} required defaultValue={account.name}/></div>
        <div className="field"><label htmlFor={`icon-${account.id}`}>Belgi</label><select id={`icon-${account.id}`} name="icon" defaultValue={account.icon}><option value="cash">Naqd</option><option value="card">Karta</option><option value="bank">Bank</option><option value="wallet">Hamyon</option></select></div>
        <div className="field"><label htmlFor={`color-${account.id}`}>Rang</label><input id={`color-${account.id}`} name="color" type="color" defaultValue={account.color}/></div>
        <label className="personal-check"><input name="include" type="checkbox" defaultChecked={account.includeInTotal}/> Jamiga qo‘shish</label>
        <button className="button" type="submit">Saqlash</button>
      </fieldset></form>
      <div className="personal-actions">{account.status==="active"?<>
        {!isDefault&&<button className="button" disabled={disabled} onClick={()=>onManage(account,"default")}>Asosiy qilish</button>}
        <button className="button" disabled={disabled} onClick={()=>onManage(account,"archive")}>Arxivlash</button>
      </>:<button className="button" disabled={disabled} onClick={()=>onManage(account,"unarchive")}>Arxivdan olish</button>}</div>
      <p className="muted">Arxiv tarixni o‘chirmaydi. Arxivdagi pul alohida ko‘rsatiladi.</p>
    </details>
    <button className="button" disabled={historyBusy} onClick={()=>void showHistory()}>Tarix</button>
    {error&&<p role="alert">{error}</p>}
    {historyOpen&&<section aria-label={`${account.name} tarixi`}>{history.map(post=><p key={post.id}>{post.effective_date} · {post.kind==="opening"?"Boshlang‘ich":post.kind} · {displayMoney(post.amount_minor,account.scale)} {account.currencyCode}</p>)}<button className="button" onClick={()=>setHistoryOpen(false)}>Yopish</button></section>}
  </article>;
}
