export function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={"min-w-0 rounded-card border p-4 " + className}
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      {(title || right) && (
        <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>}
            {subtitle && (
              <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                {subtitle}
              </p>
            )}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}
