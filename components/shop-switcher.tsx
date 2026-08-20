"use client";

import { useEffect, useState } from "react";

type Shop = { id: string; name: string };

export default function ShopSwitcher({ shopName, userEmail, liveMode }: { shopName: string; userEmail: string | null; liveMode: boolean }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [currentShopId, setCurrentShopId] = useState("");
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!liveMode) return;
    void fetch("/api/shops", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ shops?: Shop[]; currentShopId?: string | null }> : null)
      .then((data) => {
        if (!data) return;
        setShops(data.shops ?? []);
        setCurrentShopId(data.currentShopId ?? "");
      })
      .catch(() => setError("Do'konlar ro'yxatini olib bo'lmadi."));
  }, [liveMode]);

  async function switchShop(shopId: string) {
    if (!shopId || shopId === currentShopId) return;
    setSwitching(true);
    setError("");
    try {
      const response = await fetch("/api/shop/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId }) });
      if (!response.ok) {
        setError("Bu do'konga o'tib bo'lmadi.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Do'konni almashtirishda xatolik yuz berdi.");
    } finally {
      setSwitching(false);
    }
  }

  return <div className="shop-card">
    <div className="shop-label">Do&apos;kon</div>
    {shops.length > 1 ? <select className="shop-select" aria-label="Faol do'kon" value={currentShopId} disabled={switching} onChange={(event) => void switchShop(event.target.value)}>{shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select> : <div className="shop-name">{shopName}</div>}
    <div className="shop-owner">{userEmail ?? "Sinov rejimi"}</div>
    {error && <div className="shop-switch-error" role="alert">{error}</div>}
  </div>;
}
