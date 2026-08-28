import { handleAccountMeGet } from "./handler";

export async function GET(request: Request) {
  return handleAccountMeGet(request);
}
