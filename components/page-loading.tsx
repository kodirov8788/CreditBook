export default function PageLoading() {
  return (
    <main className="app-shell loading-shell" aria-busy="true" aria-live="polite">
      <div className="loading-bar" />
      <section className="loading-card">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-subtitle" />
        <div className="loading-grid">
          <div className="skeleton skeleton-panel" />
          <div className="skeleton skeleton-panel" />
          <div className="skeleton skeleton-panel wide" />
        </div>
        <span className="loading-label">Ma’lumotlar yuklanmoqda…</span>
      </section>
    </main>
  );
}
