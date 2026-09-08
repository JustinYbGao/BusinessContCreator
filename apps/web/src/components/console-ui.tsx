"use client";

import {
  ArrowRight,
  ArrowUpRight,
  BookmarkSimple,
  CalendarBlank,
  ChartLineUp,
  CheckCircle,
  CaretDown,
  Clock,
  FileText,
  FolderSimple,
  GearSix,
  House,
  ImageSquare,
  List,
  MagnifyingGlass,
  Question,
  WarningCircle,
  type IconProps,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

export type StatusTone = "attention" | "healthy" | "danger" | "quiet";

const iconByName = {
  arrow: ArrowRight,
  external: ArrowUpRight,
  bookmark: BookmarkSimple,
  calendar: CalendarBlank,
  chart: ChartLineUp,
  check: CheckCircle,
  caret: CaretDown,
  clock: Clock,
  document: FileText,
  folder: FolderSimple,
  gear: GearSix,
  home: House,
  image: ImageSquare,
  list: List,
  search: MagnifyingGlass,
  question: Question,
  warning: WarningCircle,
} as const;

export type IconName = keyof typeof iconByName;

export function IconMark({ name, size = 18, weight = "regular" }: { name: IconName; size?: number; weight?: IconProps["weight"] }) {
  const Icon = iconByName[name];
  return <Icon aria-hidden="true" size={size} weight={weight} />;
}

export function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  return <span className="status-pill" data-tone={tone}>{label}</span>;
}

export function Metric({ label, value, caption }: { label: string; value: ReactNode; caption?: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <p className="metric-value">{value}</p>
      {caption ? <p className="metric-caption">{caption}</p> : null}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
