"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, Copy, Cpu, KeyRound, LoaderCircle, Network, Server, ShieldCheck, XCircle } from "lucide-react";
import { API_URL, api } from "@/lib/api";

type OperatingSystem = "UBUNTU_24_04" | "UBUNTU_22_04" | "DEBIAN_12";
type Architecture = "AMD64" | "ARM64";
type EnrollmentStatus = "WAITING" | "PREFLIGHT" | "INSTALLING" | "VERIFYING" | "SUCCESS" | "FAILED" | "EXPIRED" | "CANCELLED";
type Enrollment = { id: string; nodeName: string; operatingSystem: OperatingSystem; architecture: Architecture; status: EnrollmentStatus; currentStep: string; lastMessage: string | null; expiresAt: string; createdAt: string };
type EnrollmentResult = { enrollment: Enrollment; enrollmentCode: string; commands: { prerequisites: string; controlPlaneToken: string; install: string } };

const systems: Array<{ id: OperatingSystem; name: string; version: string; copy: string }> = [
  { id: "UBUNTU_24_04", name: "Ubuntu Server", version: "24.04 LTS", copy: "Recommended for new game nodes." },
  { id: "UBUNTU_22_04", name: "Ubuntu Server", version: "22.04 LTS", copy: "Supported long-term release." },
  { id: "DEBIAN_12", name: "Debian", version: "12 Bookworm", copy: "Minimal and fully supported." },
];
const activeStatuses: EnrollmentStatus[] = ["WAITING", "PREFLIGHT", "INSTALLING", "VERIFYING"];
const statusOrder: EnrollmentStatus[] = ["WAITING", "PREFLIGHT", "INSTALLING", "VERIFYING", "SUCCESS"];

export default function AddNodePage() {
  const [step, setStep] = useState(0);
  const [operatingSystem, setOperatingSystem] = useState<OperatingSystem>("UBUNTU_24_04");
  const [architecture, setArchitecture] = useState<Architecture>("AMD64");
  const [nodeName, setNodeName] = useState("game-node-02");
  const [riftgridUrl, setRiftgridUrl] = useState("");
  const [kubernetesServerUrl, setKubernetesServerUrl] = useState("");
  const [result, setResult] = useState<EnrollmentResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enrollmentId = result?.enrollment.id;
  const enrollmentStatus = result?.enrollment.status;

  useEffect(() => {
    const configured = new URL(API_URL, window.location.origin);
    if (!["localhost", "127.0.0.1", "::1"].includes(configured.hostname)) setRiftgridUrl(configured.origin);
  }, []);

  useEffect(() => {
    if (!enrollmentId || !enrollmentStatus || !activeStatuses.includes(enrollmentStatus)) return;
    const timer = window.setInterval(() => {
      api<{ enrollment: Enrollment }>(`/api/v1/node-enrollments/${enrollmentId}`)
        .then(({ enrollment }) => setResult((current) => current ? { ...current, enrollment } : current))
        .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not refresh enrollment status"));
    }, 3500);
    return () => window.clearInterval(timer);
  }, [enrollmentId, enrollmentStatus]);

  const networkValid = useMemo(() => {
    try {
      const riftgrid = new URL(riftgridUrl); const kubernetes = new URL(kubernetesServerUrl);
      return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(nodeName) && ["http:", "https:"].includes(riftgrid.protocol) && kubernetes.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(riftgrid.hostname) && !["localhost", "127.0.0.1", "::1"].includes(kubernetes.hostname);
    } catch { return false; }
  }, [kubernetesServerUrl, nodeName, riftgridUrl]);

  async function createEnrollment() {
    setBusy(true); setError("");
    try {
      const created = await api<EnrollmentResult>("/api/v1/node-enrollments", { method: "POST", body: JSON.stringify({ nodeName, operatingSystem, architecture, riftgridUrl, kubernetesServerUrl }) });
      setResult(created); setStep(2);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create node enrollment"); }
    finally { setBusy(false); }
  }

  async function cancelEnrollment() {
    if (!result) return;
    setBusy(true); setError("");
    try {
      const { enrollment } = await api<{ enrollment: Enrollment }>(`/api/v1/node-enrollments/${result.enrollment.id}/cancel`, { method: "POST" });
      setResult({ ...result, enrollment });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not cancel enrollment"); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-[1200px]">
    <div className="mb-8 flex items-center gap-4"><Link href="/dashboard/nodes" className="rounded-lg border border-white/[.08] p-2.5 text-muted hover:text-white"><ArrowLeft size={17}/></Link><div><p className="label text-lime">Cluster expansion</p><h1 className="mt-2 text-4xl font-bold tracking-[-.045em]">Add a node</h1></div></div>
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="panel h-fit rounded-xl p-5"><p className="label">Guided setup</p><div className="mt-5 space-y-1"><StepLabel number="01" title="Operating system" active={step === 0} done={step > 0}/><StepLabel number="02" title="Connection" active={step === 1} done={step > 1}/><StepLabel number="03" title="Install & verify" active={step === 2} done={result?.enrollment.status === "SUCCESS"}/></div><div className="mt-6 border-t border-white/[.06] pt-5 text-xs leading-relaxed text-muted"><ShieldCheck className="mb-3 text-lime" size={18}/>The Kubernetes join token never passes through RIFTGRID. You paste it directly into a hidden prompt on the new server.</div></aside>
      <main className="panel min-h-[650px] rounded-xl p-6 sm:p-8">
        {error && <div className="mb-6 flex gap-3 rounded-lg border border-red-400/20 bg-red-400/[.05] p-4 text-sm text-red-200"><AlertTriangle className="shrink-0" size={17}/><span>{error}</span></div>}
        {step === 0 && <SystemStep operatingSystem={operatingSystem} setOperatingSystem={setOperatingSystem} architecture={architecture} setArchitecture={setArchitecture}/>}
        {step === 1 && <ConnectionStep nodeName={nodeName} setNodeName={setNodeName} riftgridUrl={riftgridUrl} setRiftgridUrl={setRiftgridUrl} kubernetesServerUrl={kubernetesServerUrl} setKubernetesServerUrl={setKubernetesServerUrl}/>}
        {step === 2 && result && <InstallStep result={result}/>}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.06] pt-6">
          <div>{step === 1 && <button className="btn" onClick={() => setStep(0)}><ArrowLeft size={15}/> Back</button>}{step === 2 && activeStatuses.includes(result?.enrollment.status ?? "CANCELLED") && <button className="btn btn-danger" disabled={busy} onClick={cancelEnrollment}>Cancel enrollment</button>}</div>
          {step === 0 && <button className="btn btn-primary" onClick={() => setStep(1)}>Connection details <ArrowRight size={15}/></button>}
          {step === 1 && <button className="btn btn-primary" disabled={!networkValid || busy} onClick={createEnrollment}>{busy ? <LoaderCircle className="animate-spin" size={15}/> : <KeyRound size={15}/>} Create one-time enrollment</button>}
          {step === 2 && result?.enrollment.status === "SUCCESS" && <Link href="/dashboard/nodes" className="btn btn-primary">Open nodes <ArrowRight size={15}/></Link>}
        </div>
      </main>
    </div>
  </div>;
}

function SystemStep({ operatingSystem, setOperatingSystem, architecture, setArchitecture }: { operatingSystem: OperatingSystem; setOperatingSystem: (value: OperatingSystem) => void; architecture: Architecture; setArchitecture: (value: Architecture) => void }) {
  return <div><p className="label text-purple">01 / Target server</p><h2 className="mt-4 text-3xl font-semibold">Which operating system is installed?</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">Use a clean Linux server with a fixed private IP, internet access and SSH/sudo access. Windows Server is not supported as a Kubernetes game node.</p><div className="mt-8 grid gap-3 md:grid-cols-3">{systems.map((system) => <button key={system.id} onClick={() => setOperatingSystem(system.id)} className={`rounded-xl border p-5 text-left transition ${operatingSystem === system.id ? "border-lime/50 bg-lime/[.06]" : "border-white/[.07] bg-black/20 hover:border-white/20"}`}><div className="flex items-center justify-between"><Server className={operatingSystem === system.id ? "text-lime" : "text-muted"} size={20}/>{operatingSystem === system.id && <Check size={16} className="text-lime"/>}</div><p className="mt-5 font-semibold">{system.name}</p><p className="mt-1 font-mono text-xs text-cyan">{system.version}</p><p className="mt-4 text-xs leading-relaxed text-muted">{system.copy}</p></button>)}</div><div className="mt-8"><p className="label">CPU architecture</p><div className="mt-3 grid max-w-lg grid-cols-2 gap-3">{(["AMD64", "ARM64"] as Architecture[]).map((item) => <button key={item} onClick={() => setArchitecture(item)} className={`flex items-center gap-3 rounded-lg border p-4 text-sm ${architecture === item ? "border-cyan/50 bg-cyan/[.05] text-cyan" : "border-white/[.07] text-muted"}`}><Cpu size={17}/><span><b>{item}</b><span className="ml-2 text-[10px] opacity-60">{item === "AMD64" ? "Intel / AMD" : "ARM 64-bit"}</span></span></button>)}</div></div></div>;
}

function ConnectionStep({ nodeName, setNodeName, riftgridUrl, setRiftgridUrl, kubernetesServerUrl, setKubernetesServerUrl }: { nodeName: string; setNodeName: (value: string) => void; riftgridUrl: string; setRiftgridUrl: (value: string) => void; kubernetesServerUrl: string; setKubernetesServerUrl: (value: string) => void }) {
  return <div><p className="label text-purple">02 / Network</p><h2 className="mt-4 text-3xl font-semibold">Connect both servers.</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">Enter addresses that the new server can actually reach. Do not use localhost: on the second machine, localhost points back to itself.</p><div className="mt-8 grid gap-5 md:grid-cols-2"><label><span className="label">New node name</span><input className="field mt-2 font-mono" value={nodeName} onChange={(event) => setNodeName(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="game-node-02"/><span className="mt-2 block text-[11px] text-muted">Unique lowercase DNS name.</span></label><label><span className="label">RIFTGRID API reachable from node</span><input className="field mt-2 font-mono" value={riftgridUrl} onChange={(event) => setRiftgridUrl(event.target.value)} placeholder="https://panel.example.com"/><span className="mt-2 block text-[11px] text-muted">For local testing, use the RIFTGRID host LAN IP instead of localhost.</span></label><label className="md:col-span-2"><span className="label">Kubernetes control-plane endpoint</span><input className="field mt-2 font-mono" value={kubernetesServerUrl} onChange={(event) => setKubernetesServerUrl(event.target.value)} placeholder="https://10.0.0.10:6443"/><span className="mt-2 block text-[11px] text-muted">Private/VPN address of the existing k3s server. Port 6443 must be reachable from the new node.</span></label></div><div className="mt-8 grid gap-3 md:grid-cols-3"><Requirement icon={<Network/>} port="TCP 6443" copy="New node → control plane"/><Requirement icon={<Network/>} port="TCP 10250" copy="Between cluster nodes"/><Requirement icon={<Network/>} port="UDP 8472" copy="Between nodes using Flannel VXLAN"/></div><div className="mt-6 flex gap-3 rounded-lg border border-amber-300/15 bg-amber-300/[.04] p-4 text-xs leading-relaxed text-amber-100/70"><AlertTriangle size={17} className="shrink-0 text-amber-200"/><p>This guided flow expands a real <b className="text-amber-100">k3s cluster</b>. A local k3d development cluster runs inside Docker and is not a suitable control plane for remote worker nodes.</p></div></div>;
}

function InstallStep({ result }: { result: EnrollmentResult }) {
  const currentIndex = statusOrder.indexOf(result.enrollment.status);
  const failed = ["FAILED", "EXPIRED", "CANCELLED"].includes(result.enrollment.status);
  return <div><p className="label text-purple">03 / Remote installation</p><div className="mt-4 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-3xl font-semibold">Run these commands in order.</h2><p className="mt-3 text-sm text-muted">Enrollment for <span className="font-mono text-white">{result.enrollment.nodeName}</span> expires at {new Date(result.enrollment.expiresAt).toLocaleTimeString()}.</p></div><StatusBadge status={result.enrollment.status}/></div><div className="mt-8 space-y-5"><CommandCard number="1" title="Prepare the new server" place="Run on the NEW server" command={result.commands.prerequisites}/><CommandCard number="2" title="Read the Kubernetes join token" place="Run on the EXISTING k3s control-plane server" command={result.commands.controlPlaneToken} secret/><SecretCard code={result.enrollmentCode}/><CommandCard number="3" title="Download and start the guided installer" place="Run on the NEW server" command={result.commands.install}/></div><div className={`mt-8 rounded-xl border p-5 ${failed ? "border-red-400/20 bg-red-400/[.04]" : result.enrollment.status === "SUCCESS" ? "border-lime/25 bg-lime/[.04]" : "border-white/[.08] bg-black/20"}`}><div className="flex items-start gap-4">{failed ? <XCircle className="shrink-0 text-red-300"/> : result.enrollment.status === "SUCCESS" ? <CheckCircle2 className="shrink-0 text-lime"/> : <LoaderCircle className="shrink-0 animate-spin text-cyan"/>}<div className="min-w-0 flex-1"><p className="font-semibold">{result.enrollment.currentStep}</p><p className="mt-2 text-xs leading-relaxed text-muted">{result.enrollment.lastMessage ?? "Waiting for the installer to connect with the one-time enrollment code."}</p><div className="mt-5 grid grid-cols-5 gap-2">{statusOrder.map((status, index) => <div key={status}><div className={`h-1 rounded-full ${currentIndex >= index && !failed ? "bg-lime" : "bg-white/[.07]"}`}/><p className="mt-2 hidden font-mono text-[8px] text-muted sm:block">{status}</p></div>)}</div></div></div></div></div>;
}

function StepLabel({ number, title, active, done }: { number: string; title: string; active: boolean; done?: boolean }) { return <div className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm ${active ? "bg-lime/[.07] text-white" : "text-muted"}`}><span className={`flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[9px] ${done ? "border-lime/40 bg-lime/[.08] text-lime" : active ? "border-white/20 text-white" : "border-white/[.07]"}`}>{done ? <Check size={13}/> : number}</span>{title}</div>; }
function Requirement({ icon, port, copy }: { icon: React.ReactNode; port: string; copy: string }) { return <div className="rounded-lg border border-white/[.06] bg-black/20 p-4"><div className="text-cyan">{icon}</div><p className="mt-3 font-mono text-sm font-bold">{port}</p><p className="mt-1 text-[10px] text-muted">{copy}</p></div>; }
function StatusBadge({ status }: { status: EnrollmentStatus }) { const terminal = status === "SUCCESS"; const failed = ["FAILED", "EXPIRED", "CANCELLED"].includes(status); return <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 font-mono text-[9px] ${terminal ? "border-lime/30 text-lime" : failed ? "border-red-400/20 text-red-300" : "border-cyan/25 text-cyan"}`}>{terminal ? <CheckCircle2 size={13}/> : failed ? <XCircle size={13}/> : <Clock3 size={13}/>} {status}</span>; }
function CommandCard({ number, title, place, command, secret }: { number: string; title: string; place: string; command: string; secret?: boolean }) { return <section className="overflow-hidden rounded-xl border border-white/[.07]"><div className="flex items-center justify-between gap-4 bg-white/[.025] px-4 py-3"><div className="flex items-center gap-3"><span className="font-mono text-[9px] text-lime">{number.padStart(2, "0")}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-[9px] text-muted">{place}</p></div></div>{secret && <span className="flex items-center gap-1 font-mono text-[8px] text-amber-200"><KeyRound size={11}/> SECRET</span>}</div><div className="relative bg-[#05070a] p-4 pr-14"><pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-cyan">{command}</pre><CopyButton value={command}/></div></section>; }
function SecretCard({ code }: { code: string }) { return <section className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-4"><div className="flex items-center gap-2"><KeyRound size={15} className="text-amber-200"/><p className="label text-amber-200">One-time RIFTGRID enrollment code</p></div><div className="relative mt-3 rounded-lg bg-black/30 p-4 pr-14"><code className="break-all font-mono text-xs text-amber-100">{code}</code><CopyButton value={code}/></div><p className="mt-3 text-[10px] leading-relaxed text-muted">Paste this into the first hidden installer prompt. It is valid only for this enrollment and is not stored in recoverable form.</p></section>; }
function CopyButton({ value }: { value: string }) { const [copied, setCopied] = useState(false); async function copy() { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } return <button aria-label="Copy command" onClick={copy} className="absolute right-3 top-3 rounded-md border border-white/[.08] bg-white/[.03] p-2 text-muted hover:text-lime">{copied ? <Check size={14}/> : <Copy size={14}/>}</button>; }
