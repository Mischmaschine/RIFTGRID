"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Boxes, Cable, Database, Gauge, HardDrive, Layers3, Network, PackageOpen, Plus, Server, Settings, ShieldCheck, Users } from "lucide-react";

type NavItem = { label: string; href?: string; icon: React.ComponentType<{ size?: number }>; title?: string };
const sections: Array<{ label: string; items: NavItem[] }> = [
  { label: "Deployments", items: [
    { label: "Servers", href: "/dashboard/servers", icon: Server },
    { label: "Installers", href: "/dashboard/installers", icon: PackageOpen },
    { label: "Templates", href: "/dashboard/templates", icon: Layers3 },
  ] },
  { label: "Infrastructure", items: [
    { label: "Cluster", href: "/dashboard/cluster", icon: Gauge },
    { label: "Nodes", href: "/dashboard/nodes", icon: Boxes },
    { label: "Network", href: "/dashboard/network", icon: Network },
    { label: "Storage", href: "/dashboard/storage", icon: HardDrive },
  ] },
  { label: "Operations", items: [
    { label: "Backups", href: "/dashboard/backups", icon: ShieldCheck },
    { label: "Databases", href: "/dashboard/databases", icon: Database },
    { label: "Activity", href: "/dashboard/activity", icon: Activity },
    { label: "Tasks", href: "/dashboard/tasks", icon: Cable },
  ] },
  { label: "Extensions", items: [
    { label: "Game Adapters", href: "/dashboard/adapters", icon: PackageOpen },
  ] },
  { label: "Administration", items: [
    { label: "Users", href: "/dashboard/users", icon: Users },
    { label: "Settings", href: "/dashboard/settings", icon: Settings },
  ] },
];

export function Sidebar() {
  const path = usePathname();
  return <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-white/[.06] bg-[#06070a] lg:block">
    <div className="flex h-20 items-center border-b border-white/[.06] px-7 font-mono text-sm font-black tracking-[.25em]">RIFT<span className="text-lime">GRID</span></div>
    <div className="px-4 pt-5"><Link href="/dashboard/deploy" className="group flex items-center justify-between rounded-xl border border-lime/25 bg-gradient-to-r from-lime/[.12] to-cyan/[.04] px-4 py-3.5 text-sm font-semibold shadow-[inset_0_1px_rgba(255,255,255,.04)] transition hover:border-lime/50"><span className="flex items-center gap-3"><Plus size={16} className="text-lime"/>Deploy Server</span><span className="font-mono text-[8px] tracking-widest text-lime/60">NEW</span></Link></div>
    <nav className="h-[calc(100vh-10.5rem)] overflow-y-auto px-4 pb-8 pt-4">
      <NavLink item={{ label: "Overview", href: "/dashboard", icon: Gauge }} path={path}/>
      {sections.map((section) => <section key={section.label}><p className="label mb-2 mt-6 px-3">{section.label}</p><div className="space-y-0.5">{section.items.map((item) => <NavLink key={item.label} item={item} path={path}/>)}</div></section>)}
    </nav>
  </aside>;
}

function NavLink({ item, path }: { item: NavItem; path: string }) {
  const Icon = item.icon;
  if (!item.href) return <div aria-disabled="true" title={item.title} className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/25"><Icon size={15}/><span>{item.label}</span></div>;
  const active = path === item.href || (item.href !== "/dashboard" && path.startsWith(`${item.href}/`));
  return <Link href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-lime/[.08] text-lime" : "text-muted hover:bg-white/[.03] hover:text-white"}`}><Icon size={15}/>{item.label}</Link>;
}
