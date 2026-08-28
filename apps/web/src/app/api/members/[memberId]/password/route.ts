import { handleMemberPasswordPost } from "./handler";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  return handleMemberPasswordPost(request, await params);
}
