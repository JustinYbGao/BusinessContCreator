import { handleAccountPasswordPost } from "./handler";

export async function POST(request: Request) {
  return handleAccountPasswordPost(request);
}
