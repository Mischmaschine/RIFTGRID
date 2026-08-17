"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Server as ServerIcon } from "lucide-react";
import { api } from "@/lib/api";
import { StatusPill } from "@/components/status-pill";

type ServerRecord = { id: string; name: string; adapterId: string; installerId: string; installerVersion: string; actualState: string; desiredState: string; cpuMillicores: number; memoryMiB: number; storageGiB: number; createdAt: string };
export default function ServersPage() {
  const [items, setItems] = useState<ServerRecord[]>([]); const [loaded, setLoaded] = useState(false);
  useEffect(() => { api<{ servers: ServerRecord[] }>("/api/v1/servers").then((response) => setItems(response.servers)).finally(() => setLoaded(true)); }, []);
  return <div className="mx-auto max-w-[1300px]"><div className="mb-9 flex items-end justify-between"><div><p className="label text-lime">Deployment inventory</p><h1 className="mt-3 text-4xl font-bold tracking-[-.045em]">Servers</h1></div><Link href="/dashboard/deploy" className="btn btn-primary"><Plus size={16}/>DEPLOY SERVER</Link></div>
    {!loaded ? <p className="text-muted">Loading deployments…</p> : items.length === 0 ? <div className="panel flex min-h-96 flex-col items-center justify-center rounded-2xl text-center"><div className="rounded-xl border border-lime/20 bg-lime/[.05] p-4 text-lime"><ServerIcon/></div><h2 className="mt-6 text-2xl font-semibold">Deploy your first server.</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted">Choose an installer. RIFTGRID will resolve runtime, find capacity, attach storage, allocate networking and verify actual health.</p><Link href="/dashboard/deploy" className="btn btn-primary mt-7">DEPLOY SERVER <ArrowRight size={15}/></Link></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <Link href={`/dashboard/servers/${item.id}`} key={item.id} className="panel group rounded-xl p-5 transition hover:border-lime/30"><div className="flex justify-between"><span className="font-mono text-[10px] uppercase text-muted">{item.installerId} / manifest {item.installerVersion}</span><StatusPill state={item.actualState}/></div><h2 className="mt-7 text-2xl font-semibold tracking-tight">{item.name}</h2><div className="mt-5 grid grid-cols-3 border-t border-white/[.06] pt-4 text-xs"><span><b>{item.cpuMillicores / 1000}</b><em className="mt-1 block not-italic text-muted">CPU</em></span><span><b>{item.memoryMiB / 1024} GB</b><em className="mt-1 block not-italic text-muted">RAM</em></span><span><b>{item.storageGiB} GB</b><em className="mt-1 block not-italic text-muted">Storage</em></span></div><ArrowRight className="mt-5 text-muted transition group-hover:translate-x-1 group-hover:text-lime" size={16}/></Link>)}</div>}
  </div>;
}
