import type { ReviewFinding } from "./structure.js";
import { buildReviewCorpus, type ReviewCorpusEntry } from "./structure.js";

export type ComplianceRule = {
  code: string;
  message: string;
  matches: (text: string) => boolean;
};

export const COMPLIANCE_RULES: readonly ComplianceRule[] = [
  {
    code: "COMPLIANCE_EMAIL_ADDRESS",
    message: "Email addresses cannot appear in public content.",
    matches: (text) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(text),
  },
  {
    code: "COMPLIANCE_WECHAT_CONTACT",
    message: "Off-platform WeChat contact or account diversion is not allowed.",
    matches: (text) => /微信|wechat|weixin|(?:加|添加|联系).{0,3}(?:我|个)?\s*(?:微信|wx|vx)/iu.test(text),
  },
  {
    code: "COMPLIANCE_PHONE_NUMBER",
    message: "Phone numbers cannot appear in public content.",
    matches: (text) => /(?<!\d)1[3-9]\d{9}(?!\d)/u.test(text.replace(/[\s().-]/gu, "")),
  },
  {
    code: "COMPLIANCE_PRIVATE_MESSAGE",
    message: "Private-message diversion or gated delivery is not allowed.",
    matches: (text) => /私信|私聊|私发|私下联系|看主页|加我|加群|群聊|联系方式|联系我/u.test(text),
  },
  {
    code: "COMPLIANCE_WECHAT_MINIPROGRAM_QR",
    message: "QR-code or WeChat mini-program diversion is not allowed.",
    matches: (text) => /二维码|扫码|扫描/u.test(text),
  },
  {
    code: "COMPLIANCE_EXAGGERATED_FIRST",
    message: "Unsupported superlative or absolute claims are not allowed.",
    matches: (text) => /(?:全国|全网|行业|中国)第一(?:名|的)?|第一(?:名|位|品牌|款|个|选择|推荐|的)|第一(?!步|次|时间|天|章|页|行)|顶级|百分(?:之百|百)|100%|最(?:强|佳|好|大|高|低)|无敌|绝对/u.test(text),
  },
];

function finding(rule: ComplianceRule, entry: ReviewCorpusEntry): ReviewFinding {
  return {
    code: rule.code,
    severity: "blocking",
    message: rule.message,
    field: entry.field,
    path: entry.path,
  };
}

export function findComplianceFindings(
  draft: unknown,
  sourceAssets: readonly { id: string; kind?: string; sourceLocator?: string | null }[] = [],
): ReviewFinding[] {
  const corpus = buildReviewCorpus(draft, sourceAssets);
  return COMPLIANCE_RULES.flatMap((rule) => {
    const entry = corpus.find((candidate) => rule.matches(candidate.text));
    return entry ? [finding(rule, entry)] : [];
  });
}
