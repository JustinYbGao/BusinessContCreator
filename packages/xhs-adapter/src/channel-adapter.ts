import type { PublicationPackage } from "@social-agent/contracts";
import { validatePublicationPackage, type PublicationScope } from "./package.js";

export class XiaohongshuChannelAdapter {
  readonly channel = "xiaohongshu" as const;

  preparePublication(input: { publication: unknown; scope: PublicationScope }): PublicationPackage {
    return validatePublicationPackage(input.publication, input.scope);
  }
}

export const XhsChannelAdapter = XiaohongshuChannelAdapter;

export function createXhsChannelAdapter(): XiaohongshuChannelAdapter {
  return new XiaohongshuChannelAdapter();
}
