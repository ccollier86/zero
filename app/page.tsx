export const meta = {
  title: 'Platform',
  description: 'AI-native fullstack platform',
};

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Platform</h1>
      <p className="mt-2 text-muted-foreground">
        Real-time sync, auth, state, and SSR — all in one binary.
      </p>
    </main>
  );
}
