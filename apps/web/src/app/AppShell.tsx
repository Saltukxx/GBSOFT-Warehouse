import { NavLink, Outlet } from "react-router-dom";
import type { IconName } from "../components/ui/Icon";
import { Icon } from "../components/ui/Icon";
import { CURRENT_USER, FACILITY } from "@gbsoft/seed";
import { timeOnly } from "../lib/format";

type NavItem = { to: string; label: string; icon: IconName; end?: boolean };

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Operasyon",
    items: [
      { to: "/operations", label: "Genel bakış", icon: "overview" },
      { to: "/operations/picking", label: "Picking Control", icon: "picking" },
      { to: "/operations/exceptions", label: "İstisnalar", icon: "exception" },
    ],
  },
  {
    label: "Optimizasyon",
    items: [
      { to: "/optimization/slotting", label: "Slotting Studio", icon: "slotting" },
      { to: "/optimization/moves", label: "Move Plan", icon: "moves" },
      { to: "/optimization/history", label: "Plan geçmişi", icon: "history" },
    ],
  },
  {
    label: "Analiz",
    items: [
      { to: "/analysis/time", label: "Time Intelligence", icon: "time" },
      { to: "/analysis/sku", label: "SKU analizi", icon: "sku" },
      { to: "/analysis/locations", label: "Lokasyon analizi", icon: "location" },
    ],
  },
  {
    label: "Sistem",
    items: [
      { to: "/system/imports", label: "Veri aktarımı", icon: "upload" },
      { to: "/system/layout", label: "Layout editörü", icon: "slotting" },
      { to: "/data-quality", label: "Veri kalitesi", icon: "quality" },
      { to: "/system/integrations", label: "Entegrasyonlar", icon: "integration" },
      { to: "/system/model", label: "Model ve solver", icon: "model" },
    ],
  },
];

export function AppShell() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <svg
            className="topbar__mark"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <rect x="1" y="7" width="5" height="12" fill="#5b8fb0" />
            <rect x="7.5" y="3" width="5" height="16" fill="#8fb8d0" />
            <rect x="14" y="10" width="5" height="9" fill="#ffffff" />
          </svg>
          <span>GBSoft Warehouse Intelligence</span>
        </div>

        <div className="topbar__facts">
          <div className="topbar__fact">
            Tesis
            <strong>{FACILITY.name}</strong>
          </div>
          <div className="topbar__fact">
            Son veri
            <strong>
              {timeOnly(FACILITY.snapshotAt)} · {FACILITY.shift}
            </strong>
          </div>
          <span className="topbar__demo-tag">Demo verisi</span>
          <div className="topbar__user">
            <span className="topbar__avatar">{CURRENT_USER.initials}</span>
            <div className="topbar__fact">
              {CURRENT_USER.role}
              <strong>{CURRENT_USER.name}</strong>
            </div>
          </div>
        </div>
      </header>

      <nav className="nav" aria-label="Ana menü">
        {NAV_GROUPS.map((group) => (
          <div className="nav__group" key={group.label}>
            <div className="nav__group-label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/operations"}
                className={({ isActive }) =>
                  `nav__link${isActive ? " nav__link--active" : ""}`
                }
                title={item.label}
              >
                <Icon name={item.icon} size={16} />
                <span className="nav__label">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
