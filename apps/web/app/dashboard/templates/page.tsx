"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, History, Layers3, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";

type Template = { id: string; name: string; description: string; revision: number; installerId: string; installerVersion: string; configuration: Record<string, unknown>; cpuMillicores: number; memoryMiB: number; storageGiB: number; placement: Record<string, unknown>; updatedAt: string };
type TemplateRevision = Omit<Template, "id" | "updatedAt"> & { id: string; templateId: string; createdAt: string };
type Deployment = { id: string; name: string; installerId: string; installerVersion: string; configuration: Record<string, unknown>; cpuMillicores: number; memoryMiB: number; storageGiB: number; nodeId: string | null };
type TemplateDraft = { name: string; description: string; cpu: number; ram: number; storage: number };

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [servers, setServers] = useState<Deployment[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [historyId, setHistoryId] = useState("");
  const [histories, setHistories] = useState<Record<string, TemplateRevision[]>>({});
  const [draft, setDraft] = useState<TemplateDraft>({ name: "", description: "", cpu: 1, ram: 1, storage: 1 });

  const load = useCallback(async () => {
    const [templateData, serverData] = await Promise.all([api<{ templates: Template[] }>("/api/v1/templates"), api<{ servers: Deployment[] }>("/api/v1/servers")]);
    setTemplates(templateData.templates);
    setServers(serverData.servers);
    setSourceId((current) => current || serverData.servers[0]?.id || "");
  }, []);

  useEffect(() => { void load().catch((reason) => setError(reason.message)); }, [load]);

  async function create() {
    const source = servers.find((server) => server.id === sourceId);
    if (!source) return;
    setSaving(true); setError("");
    try {
      await api("/api/v1/templates", { method: "POST", body: JSON.stringify({ name, description, installerId: source.installerId, configuration: source.configuration, resources: { cpuMillicores: source.cpuMillicores, memoryMiB: source.memoryMiB, storageGiB: source.storageGiB }, placement: source.nodeId ? { nodeId: source.nodeId } : {} }) });
      setName(""); setDescription(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Template could not be saved"); }
    finally { setSaving(false); }
  }

  function beginEdit(template: Template) {
    setEditingId(template.id);
    setDraft({ name: template.name, description: template.description, cpu: template.cpuMillicores / 1000, ram: template.memoryMiB / 1024, storage: template.storageGiB });
    setError("");
  }

  async function save(template: Template) {
    setSaving(true); setError("");
    try {
      await api(`/api/v1/templates/${template.id}`, { method: "PATCH", body: JSON.stringify({ name: draft.name, description: draft.description, resources: { cpuMillicores: Math.round(draft.cpu * 1000), memoryMiB: Math.round(draft.ram * 1024), storageGiB: Math.round(draft.storage) } }) });
      setEditingId(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Template could not be updated"); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this deployment template? Existing deployments are unaffected.")) return;
    setError("");
    try { await api(`/api/v1/templates/${id}`, { method: "DELETE" }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Template could not be deleted"); }
  }

  async function toggleHistory(id: string) {
    if (historyId === id) { setHistoryId(""); return; }
    setHistoryId(id); setError("");
    try { const result = await api<{ revisions: TemplateRevision[] }>(`/api/v1/templates/${id}/revisions`); setHistories((current) => ({ ...current, [id]: result.revisions })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Template history could not be loaded"); }
  }

  async function restore(template: Template, revision: TemplateRevision) {
    if (!window.confirm(`Restore revision ${revision.revision} of ${template.name}? A new revision will be published; existing deployments remain unchanged.`)) return;
    setSaving(true); setError("");
    try { await api(`/api/v1/templates/${template.id}/revisions/${revision.revision}/restore`, { method: "POST", body: "{}" }); await load(); const result = await api<{ revisions: TemplateRevision[] }>(`/api/v1/templates/${template.id}/revisions`); setHistories((current) => ({ ...current, [template.id]: result.revisions })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Template revision could not be restored"); }
    finally { setSaving(false); }
  }

  const validDraft = /^[a-z0-9][a-z0-9-]{2,47}$/.test(draft.name) && draft.cpu >= 0.25 && draft.ram >= 0.5 && draft.storage >= 1;

  return <div className="mx-auto max-w-[1300px]">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="label text-lime">Reusable desired state</p><h1 className="mt-3 text-4xl font-bold tracking-[-.045em]">Templates</h1><p className="mt-3 max-w-2xl text-sm text-muted">Persist installer configuration, capacity, storage, networking, environment and placement defaults, then feed them back into Deploy Server.</p></div><Link href="/dashboard/deploy" className="btn btn-primary"><Plus size={15}/>DEPLOY SERVER</Link></div>
    <section className="panel mt-8 rounded-xl p-6"><p className="label">Create from a real deployment</p><div className="mt-5 grid gap-4 md:grid-cols-2"><label><span className="label">Source deployment</span><select className="field mt-2" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>{servers.map((server) => <option value={server.id} key={server.id}>{server.name} · {server.installerId}</option>)}</select></label><label><span className="label">Template name</span><input className="field mt-2 font-mono" placeholder="minecraft-standard" value={name} onChange={(event) => setName(event.target.value.toLowerCase())}/></label><label className="md:col-span-2"><span className="label">Description</span><input className="field mt-2" placeholder="Purpose and intended workload" value={description} onChange={(event) => setDescription(event.target.value)}/></label></div>{error && <p className="mt-4 text-sm text-red-300">{error}</p>}<button disabled={saving || !sourceId || !/^[a-z0-9][a-z0-9-]{2,47}$/.test(name)} onClick={create} className="btn btn-primary mt-5">{saving && !editingId ? "SAVING…" : "SAVE TEMPLATE"}</button></section>
    <div className="mt-7 grid gap-4 lg:grid-cols-2">{templates.map((template) => {
      const editing = editingId === template.id;
      return <article key={template.id} className="panel rounded-xl p-6"><div className="flex items-start justify-between gap-4"><div className="flex gap-3"><div className="rounded-lg bg-purple/10 p-3 text-purple"><Layers3 size={18}/></div><div><h2 className="text-lg font-semibold">{template.name}</h2><p className="mt-1 font-mono text-[9px] text-muted">{template.installerId} · manifest {template.installerVersion} · revision {template.revision}</p></div></div><div className="flex gap-3"><button onClick={() => void toggleHistory(template.id)} className={historyId === template.id ? "text-lime" : "text-muted hover:text-lime"} aria-label={`History ${template.name}`}><History size={16}/></button><button onClick={() => editing ? setEditingId("") : beginEdit(template)} className="text-muted hover:text-cyan" aria-label={`${editing ? "Cancel editing" : "Edit"} ${template.name}`}>{editing ? <X size={16}/> : <Pencil size={16}/>}</button><button onClick={() => remove(template.id)} className="text-muted hover:text-red-300" aria-label={`Delete ${template.name}`}><Trash2 size={16}/></button></div></div>
        {editing ? <div className="mt-5 space-y-4"><label className="block"><span className="label">Template name</span><input className="field mt-2 font-mono" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value.toLowerCase() }))}/></label><label className="block"><span className="label">Description</span><input className="field mt-2" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}/></label><div className="grid grid-cols-3 gap-3"><ResourceField label="CPU cores" value={draft.cpu} min={0.25} step={0.25} onChange={(cpu) => setDraft((current) => ({ ...current, cpu }))}/><ResourceField label="RAM GiB" value={draft.ram} min={0.5} step={0.5} onChange={(ram) => setDraft((current) => ({ ...current, ram }))}/><ResourceField label="Storage GiB" value={draft.storage} min={1} step={1} onChange={(storage) => setDraft((current) => ({ ...current, storage }))}/></div><div className="flex justify-end gap-2"><button disabled={saving} onClick={() => setEditingId("")} className="btn"><X size={14}/>CANCEL</button><button disabled={saving || !validDraft} onClick={() => save(template)} className="btn btn-primary"><Save size={14}/>{saving ? "SAVING…" : "PUBLISH REVISION"}</button></div></div> : <><p className="mt-4 text-sm leading-relaxed text-muted">{template.description || "No description"}</p><div className="mt-5 grid grid-cols-3 gap-2"><Fact label="CPU" value={`${template.cpuMillicores / 1000} cores`}/><Fact label="RAM" value={`${template.memoryMiB / 1024} GiB`}/><Fact label="Storage" value={`${template.storageGiB} GiB`}/></div><div className="mt-5 flex items-center justify-between border-t border-white/[.06] pt-4"><span className="text-[10px] text-muted">Updated {new Date(template.updatedAt).toLocaleString()}</span><Link href={`/dashboard/deploy?template=${template.id}`} className="text-xs font-semibold text-lime">USE TEMPLATE <ArrowRight className="ml-1 inline" size={12}/></Link></div></>}
        {historyId === template.id && <div className="mt-5 border-t border-white/[.06] pt-5"><p className="label">Revision history</p><div className="mt-3 space-y-2">{(histories[template.id] ?? []).map((revision) => <div key={revision.id} className="flex items-center justify-between rounded-lg border border-white/[.06] bg-black/20 p-3"><div><p className="font-mono text-[10px]">REVISION {revision.revision}{revision.revision === template.revision ? " · CURRENT" : ""}</p><p className="mt-1 text-[9px] text-muted">{new Date(revision.createdAt).toLocaleString()} · {revision.cpuMillicores / 1000} CPU · {revision.memoryMiB / 1024} GiB RAM · {revision.storageGiB} GiB</p></div>{revision.revision !== template.revision && <button disabled={saving} onClick={() => void restore(template, revision)} className="btn py-2 text-[10px]"><RotateCcw size={12}/>RESTORE</button>}</div>)}{!histories[template.id]?.length && <p className="text-xs text-muted">Loading revision history…</p>}</div></div>}
      </article>;
    })}</div>{templates.length === 0 && <div className="panel mt-7 rounded-xl p-10 text-center text-muted">No templates yet. Save the proven configuration of an existing deployment above.</div>}
  </div>;
}

function ResourceField({ label, value, min, step, onChange }: { label: string; value: number; min: number; step: number; onChange: (value: number) => void }) { return <label><span className="label">{label}</span><input className="field mt-2 font-mono" type="number" min={min} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-black/20 p-3"><p className="label">{label}</p><p className="mt-2 text-xs font-semibold">{value}</p></div>; }
