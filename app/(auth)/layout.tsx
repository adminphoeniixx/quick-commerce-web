export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10" style={{ background: "var(--plane)" }}>
      {children}
    </div>
  );
}
