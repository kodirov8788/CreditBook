import Link from "next/link";

export default function NotFound() {
  return <main className="app-shell error-shell" role="status"><section className="loading-card"><div className="eyebrow">404</div><h1>Sahifa topilmadi.</h1><p className="muted">Manzilni tekshiring yoki bosh sahifaga qayting.</p><Link className="button button-primary" href="/dashboard">Bosh sahifaga qaytish</Link></section></main>;
}
