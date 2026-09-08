"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconMark, type IconName } from "./console-ui";

const primaryNavigation: ReadonlyArray<readonly [string, string, IconName]> = [
  ["工作台", "/app", "home"],
  ["产品事实", "/app/products", "folder"],
  ["内容包", "/app/review", "document"],
  ["选题库", "/app/campaigns", "bookmark"],
  ["发布计划", "/app/publications", "calendar"],
  ["数据洞察", "/app/analytics", "chart"],
];

const secondaryNavigation: ReadonlyArray<readonly [string, string, IconName]> = [
  ["发布设备", "/app/settings/publisher-devices", "gear"],
];

function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}

function NavigationLinks({ pathname }: { pathname: string }) {
  return (
    <>
      <nav aria-label="控制台导航" className="console-nav">
        {primaryNavigation.map(([label, href, icon]) => {
          const active = isActive(pathname, href);
          return (
            <Link aria-current={active ? "page" : undefined} className="console-nav-link" data-active={active} href={href} key={href}>
              <IconMark name={icon} size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <nav aria-label="设置导航" className="console-nav-group">
        {secondaryNavigation.map(([label, href, icon]) => {
          const active = isActive(pathname, href);
          return (
            <Link aria-current={active ? "page" : undefined} className="console-nav-link" data-active={active} href={href} key={href}>
              <IconMark name={icon} size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export default function ConsoleNav({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();

  return (
    <>
      <aside className="console-sidebar">
        <div className="console-sidebar-brand">
          <Link className="site-brand" href="/app">
            <span aria-hidden="true" className="site-brand-mark">S</span>
            <span>SocialMediaAgent</span>
          </Link>
        </div>
        <NavigationLinks pathname={pathname} />
        <div className="console-sidebar-meta">
          <strong>当前工作空间</strong>
          <span className="mono">{workspaceId}</span>
        </div>
      </aside>
      <div className="console-mobilebar">
        <Link className="site-brand" href="/app">
          <span aria-hidden="true" className="site-brand-mark">S</span>
          <span>SocialMediaAgent</span>
        </Link>
        <details className="console-mobile-menu">
          <summary aria-label="打开控制台导航" className="mobile-menu-trigger"><IconMark name="list" size={20} /><span>菜单</span></summary>
          <div className="mobile-menu-panel"><NavigationLinks pathname={pathname} /></div>
        </details>
      </div>
    </>
  );
}
