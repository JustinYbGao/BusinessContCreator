import { requireServerInternalWorkspace, createSupabaseServiceRoleClient } from "../../../../lib/supabase/server";
import DeviceManager, { type PublisherDevice } from "./device-manager";

export const dynamic = "force-dynamic";

export default async function PublisherDevicesPage() {
  const context = await requireServerInternalWorkspace();
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.from("publisher_devices")
    .select("id,name,created_at,revoked_at")
    .eq("workspace_id", context.workspaceId)
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
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">Publisher devices</p>
          <h1>发布设备</h1>
          <p>设备令牌只在创建成功时显示一次。把令牌放入本地发布器的安全环境文件，不要提交到仓库或发送给他人。</p>
        </div>
      </div>
      <DeviceManager initialDevices={devices} />
    </main>
  );
}
