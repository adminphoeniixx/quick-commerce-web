"use client";

import {
  LayoutDashboard, ShoppingBag, Package, Boxes, Tag, Radar, Search, FileBarChart, Plug, UploadCloud, Users, Settings, Moon, Sun, Megaphone,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  // Every entry has its own icon so the rail stays readable without labels.
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: ShoppingBag, label: "Blinkit sales, orders & products", href: "/dashboard/seller/sales", match: "/dashboard/seller" },
  { icon: Megaphone, label: "Blinkit Ads: spend, ROAS, campaigns & keywords", href: "/dashboard/ads" },
  { icon: Package, label: "Product catalog", href: "/dashboard/products" },
  { icon: Boxes, label: "Availability", href: "/dashboard/availability" },
  { icon: Tag, label: "Pricing", href: "/dashboard/pricing" },
  { icon: Radar, label: "Share of voice", href: "/dashboard/visibility" },
  { icon: Search, label: "Keywords", href: "/dashboard/keywords" },
  { icon: FileBarChart, label: "Reports & exports", href: "/dashboard/reports" },
  { icon: Plug, label: "Connections", href: "/dashboard/connections" },
  { icon: UploadCloud, label: "Import center", href: "/dashboard/imports" },
  { icon: Users, label: "Team", href: "/dashboard/team" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <nav
      className="sticky top-0 hidden h-screen w-[58px] flex-none flex-col items-center gap-1 py-3.5 sm:flex"
      style={{ background: "var(--rail)" }}
      aria-label="Primary"
    >
      <div
        className="mb-3 grid h-[34px] w-[34px] place-items-center rounded-[9px] text-base font-extrabold text-black"
        style={{ background: "linear-gradient(135deg,#eda100,#eb6834)" }}
      >
        Q
      </div>

      {NAV.map(({ icon: Icon, label, href, ...rest }) => {
        const match = "match" in rest ? rest.match : href;
        const active = href === "/dashboard" ? pathname === href : pathname.startsWith(match ?? "#");
        return <Link
          key={label}
          href={href ?? "/dashboard"}
          title={label}
          aria-label={label}
          className="grid h-[38px] w-[38px] place-items-center rounded-[10px] transition-colors"
          style={{
            color: active ? "#fff" : "var(--rail-ink)",
            background: active ? "rgba(255,255,255,.14)" : "transparent",
          }}
        >
          <Icon size={19} />
        </Link>;
      })}

      <div className="flex-1" />

      <Link href="/dashboard/settings/security"
        title="Settings"
        aria-label="Settings"
        className="grid h-[38px] w-[38px] place-items-center rounded-[10px]"
        style={{ color: "var(--rail-ink)" }}
      >
        <Settings size={19} />
      </Link>
      <button
        title="Toggle theme"
        aria-label="Toggle theme"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        className="grid h-[38px] w-[38px] place-items-center rounded-[10px]"
        style={{ color: "var(--rail-ink)" }}
      >
        {isDark ? <Sun size={19} /> : <Moon size={19} />}
      </button>
    </nav>
  );
}
