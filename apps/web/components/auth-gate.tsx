"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
export function AuthGate({ children }: { children: React.ReactNode }) { const router = useRouter(); const [ready,setReady] = useState(false); useEffect(() => { api("/api/v1/auth/me").then(() => setReady(true)).catch(() => router.replace("/login")); }, [router]); if (!ready) return <div className="flex min-h-screen items-center justify-center"><div className="live-dot h-2 w-2 rounded-full bg-lime"/></div>; return children; }
