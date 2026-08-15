"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="app-shell error-shell" role="alert">
      <section className="loading-card">
        <div className="eyebrow">Xatolik</div>
        <h1>Ma’lumotni yuklab bo‘lmadi.</h1>
        <p className="muted">Ulanishni tekshirib, qayta urinib ko‘ring.</p>
        <button className="button button-primary" onClick={() => reset()}>Qayta urinib ko‘rish</button>
      </section>
    </main>
  );
}
