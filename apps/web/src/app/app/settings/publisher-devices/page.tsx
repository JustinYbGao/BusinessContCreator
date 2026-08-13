import { requireServerInternalAdmin, createSupabaseServiceRoleClient } from "../../../../lib/supabase/server";
import DeviceManager, { type PublisherDevice } from "./device-manager";

export const dynamic = "force-dynamic";

export default async function PublisherDevicesPage() {
  const identity = await requireServerInternalAdmin();
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.from("publisher_devices")
    .select("id,name,created_at,revoked_at")
    .eq("workspace_id", identity.workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("DEVICES_UNAVAILABLE");
  const devices: PublisherDevice[] = (data ?? []).map((device) => ({
    id: device.id,
    name: device.name,
    createdAt: device.created_at,
    revokedAt: device.revoked_at,
  }));

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Publisher devices</p>
      <h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "12px 0" }}>发布设备</h1>
      <p style={{ color: "#536057", lineHeight: 1.65, maxWidth: 720 }}>设备令牌只在创建成功时显示一次。把令牌放入本地发布器的安全环境文件，不要提交到仓库或发送给他人。</p>
      <DeviceManager initialDevices={devices} />
    </main>
  );
}
