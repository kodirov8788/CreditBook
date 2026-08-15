"use client";

import Link from "next/link";
import { ArrowRight, Search, Store } from "lucide-react";
import { useMemo, useState } from "react";

type ShopRow = { id: string; name: string; status: string; createdAt: string; memberCount: number };

export default function AdminShopsTable({ shops }: { shops: ShopRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => shops.filter((shop) => (status === "all" || shop.status === status) && (!query.trim() || `${shop.name} ${shop.id}`.toLowerCase().includes(query.trim().toLowerCase()))), [query, shops, status]);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  return <section className="admin-panel"><div className="admin-panel-head"><div><h2>{filtered.length} ta shop</h2><p>Shop nomi, ID yoki holat bo‘yicha qidiring.</p></div><div className="admin-filters"><label className="admin-search"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Shop qidirish" aria-label="Shop qidirish" /></label><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Shop holati filtri"><option value="all">Barchasi</option><option value="active">Faol</option><option value="suspended">To‘xtatilgan</option></select></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Do‘kon</th><th>A’zolar</th><th>Holat</th><th /></tr></thead><tbody>{visible.map((shop) => <tr key={shop.id}><td><span className="admin-user"><span className="admin-avatar"><Store size={16} /></span><span><strong>{shop.name}</strong><small>{new Date(shop.createdAt).toLocaleDateString("uz-UZ")}</small></span></span></td><td>{shop.memberCount}</td><td><span className={`admin-status ${shop.status}`}>{shop.status === "active" ? "Faol" : "To‘xtatilgan"}</span></td><td><Link className="icon-button" href={`/admin/shops/${shop.id}`} aria-label={`${shop.name} tafsilotlari`}><ArrowRight size={17} /></Link></td></tr>)}</tbody></table>{!filtered.length && <div className="admin-empty">Filter bo‘yicha shop topilmadi.</div>}</div>{pageCount > 1 && <div className="admin-pagination"><button className="text-button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Oldingi</button><span>{page} / {pageCount}</span><button className="text-button" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Keyingi</button></div>}</section>;
}
