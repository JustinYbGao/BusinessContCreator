import { handleMemberPatch } from "./handler";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  return handleMemberPatch(request, await params);
}
