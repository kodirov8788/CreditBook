"use client";

import Link from "next/link";
import { ArrowRight, Search, Store } from "lucide-react";

type ShopRow = { id: string; name: string; status: string; createdAt: string; memberCount: number };

export default function AdminShopsTable({ shops, totalCount, page, pageCount, query, status }: { shops: ShopRow[]; totalCount: number; page: number; pageCount: number; query: string; status: string }) {
  function pageHref(nextPage: number) {
    const params = new URLSearchParams({ page: String(nextPage), status });
    if (query) params.set("q", query);
    return `/admin/shops?${params.toString()}`;
  }

  return <section className="admin-panel"><div className="admin-panel-head"><div><h2>{totalCount} ta shop</h2><p>Shop nomi va holati serverda filtrlanadi.</p></div><form className="admin-filters" action="/admin/shops" method="get"><label className="admin-search"><Search size={16} /><input defaultValue={query} name="q" placeholder="Shop qidirish" aria-label="Shop qidirish" /></label><select defaultValue={status} name="status" aria-label="Shop holati filtri"><option value="all">Barchasi</option><option value="active">Faol</option><option value="suspended">To‘xtatilgan</option></select><button className="text-button" type="submit">Qidirish</button></form></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Do‘kon</th><th>A’zolar</th><th>Holat</th><th /></tr></thead><tbody>{shops.map((shop) => <tr key={shop.id}><td><span className="admin-user"><span className="admin-avatar"><Store size={16} /></span><span><strong>{shop.name}</strong><small>{new Date(shop.createdAt).toLocaleDateString("uz-UZ")}</small></span></span></td><td>{shop.memberCount}</td><td><span className={`admin-status ${shop.status}`}>{shop.status === "active" ? "Faol" : "To‘xtatilgan"}</span></td><td><Link className="icon-button" href={`/admin/shops/${shop.id}`} aria-label={`${shop.name} tafsilotlari`}><ArrowRight size={17} /></Link></td></tr>)}</tbody></table>{!shops.length && <div className="admin-empty">Filter bo‘yicha shop topilmadi.</div>}</div>{pageCount > 1 && <div className="admin-pagination"><Link className="text-button" aria-disabled={page === 1} href={page === 1 ? "#" : pageHref(page - 1)}>Oldingi</Link><span>{page} / {pageCount}</span><Link className="text-button" aria-disabled={page === pageCount} href={page === pageCount ? "#" : pageHref(page + 1)}>Keyingi</Link></div>}</section>;
}
