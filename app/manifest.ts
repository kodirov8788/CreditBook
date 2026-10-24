import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const personal = process.env.CREDITBOOK_NEON_ENABLED === "1";
  return {
    name: "CreditBook — Qarz daftari",
    short_name: "CreditBook",
    description: personal ? "Shaxsiy kirim-chiqim, ovoz va chek orqali hisob." : "Do'kon qarzlari va to'lovlarini oson yuriting.",
    start_url: personal ? "/personal" : "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1e7a4f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
