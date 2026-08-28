import { handleMembersGet, handleMembersPost } from "./handler";

export async function GET(request: Request) {
  return handleMembersGet(request);
}

export async function POST(request: Request) {
  return handleMembersPost(request);
}
