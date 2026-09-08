"use client";

import { IconMark, StatusPill } from "../../../../components/console-ui";
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
    <section>
      <form className="device-form" onSubmit={createDevice}>
        <label>
          <span>设备名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="MacBook 本地发布器" required maxLength={120} />
        </label>
        <button className="button button-primary" disabled={busy} type="submit">创建令牌 <IconMark name="arrow" size={16} /></button>
      </form>

      {token ? <aside className="token-panel">
        <strong>只显示这一次：</strong>
        <code>{token}</code>
        <p>请立即复制到本机安全环境文件。关闭或刷新页面后不能再次查看。</p>
      </aside> : null}

      {error ? <p className="error-message" role="alert">{error}</p> : null}

      <div className="device-list">
        {devices.map((device) => <article className="device-row" key={device.id}>
          <div>
            <strong>{device.name}</strong>
            <p>{device.revokedAt ? "已撤销" : "可用"} · 创建于 {new Date(device.createdAt).toLocaleString("zh-CN")}</p>
          </div>
          <div className="form-actions">
            <StatusPill label={device.revokedAt ? "已撤销" : "可用"} tone={device.revokedAt ? "quiet" : "healthy"} />
            {!device.revokedAt ? <button className="button button-danger button-small" disabled={busy} onClick={() => void revokeDevice(device.id)} type="button">撤销</button> : null}
          </div>
        </article>)}
      </div>
    </section>
  );
}
