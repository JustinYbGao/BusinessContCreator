import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "SocialMediaAgent",
  description: "把产品资料变成可持续迭代的内容增长系统。",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#f6f7f2", color: "#17211b", fontFamily: "Arial, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
