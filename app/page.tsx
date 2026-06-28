export const meta = {
  title: 'Platform',
  description: 'AI-native fullstack platform',
};

export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '4rem 1rem' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 600 }}>Platform</h1>
      <p style={{ color: 'rgba(255,255,255,0.55)', marginTop: '0.5rem' }}>
        Real-time sync, auth, state, and SSR — all in one binary.
      </p>
    </main>
  );
}
