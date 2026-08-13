"use client";

import { useState, type FormEvent } from "react";

export interface PublisherDevice {
  id: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
}

export default function DeviceManager({ initialDevices }: { initialDevices: PublisherDevice[] }) {
  const [devices, setDevices] = useState(initialDevices);
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/publisher/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await response.json() as { device?: { id: string; workspaceId: string; name?: string }; token?: string; error?: string };
      if (!response.ok || !body.device || !body.token) throw new Error(body.error ?? "DEVICE_CREATE_FAILED");
      setDevices((current) => [{ id: body.device!.id, name, createdAt: new Date().toISOString(), revokedAt: null }, ...current]);
      setToken(body.token);
      setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "DEVICE_CREATE_FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function revokeDevice(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/publisher/devices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("DEVICE_REVOKE_FAILED");
      setDevices((current) => current.map((device) => device.id === id ? { ...device, revokedAt: new Date().toISOString() } : device));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "DEVICE_REVOKE_FAILED");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 24, marginTop: 32 }}>
      <form onSubmit={createDevice} style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, display: "flex", gap: 12, padding: 20 }}>
        <label style={{ display: "grid", flex: 1, gap: 8 }}>
          <span style={{ color: "#536057", fontSize: 13, fontWeight: 700 }}>设备名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="MacBook 本地发布器" required maxLength={120} style={{ border: "1px solid #cbd8c8", borderRadius: 10, padding: "11px 12px" }} />
        </label>
        <button disabled={busy} type="submit" style={{ alignSelf: "end", background: "#17211b", border: 0, borderRadius: 10, color: "#fff", cursor: "pointer", padding: "12px 18px" }}>创建令牌</button>
      </form>

      {token ? <aside style={{ background: "#fff4d6", border: "1px solid #e4c56b", borderRadius: 18, padding: 20 }}>
        <strong>只显示这一次：</strong>
        <code style={{ display: "block", marginTop: 12, overflowWrap: "anywhere" }}>{token}</code>
        <p style={{ color: "#6f5d2d", fontSize: 13, marginBottom: 0 }}>请立即复制到本机安全环境文件。关闭或刷新页面后不能再次查看。</p>
      </aside> : null}

      {error ? <p role="alert" style={{ color: "#a33b32" }}>{error}</p> : null}

      <div style={{ display: "grid", gap: 12 }}>
        {devices.map((device) => <article key={device.id} style={{ alignItems: "center", background: "#fff", border: "1px solid #dbe4d8", borderRadius: 14, display: "flex", justifyContent: "space-between", gap: 20, padding: 18 }}>
          <div>
            <strong>{device.name}</strong>
            <p style={{ color: "#7b887d", fontSize: 13, margin: "6px 0 0" }}>{device.revokedAt ? "已撤销" : "可用"} · 创建于 {new Date(device.createdAt).toLocaleString("zh-CN")}</p>
          </div>
          {!device.revokedAt ? <button disabled={busy} onClick={() => void revokeDevice(device.id)} type="button" style={{ background: "transparent", border: "1px solid #d59b91", borderRadius: 9, color: "#9b3b31", cursor: "pointer", padding: "8px 12px" }}>撤销</button> : null}
        </article>)}
      </div>
    </section>
  );
}
