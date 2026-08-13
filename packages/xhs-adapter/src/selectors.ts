export const XHS_EDITOR_SELECTORS = Object.freeze({
  uploadInput: ["input[type=file][data-test=image-upload]", "input[type=file]"] as const,
  titleInput: ["[data-test=title]", "textarea[placeholder*=标题]", "input[placeholder*=标题]"] as const,
  bodyInput: ["[data-test=body]", "textarea[placeholder*=正文]", "textarea"] as const,
  uploadedCount: ["[data-test=uploaded-count]"] as const,
  loginMarkers: ["[data-test=login-required]", "[data-test=login-form]", "input[type=password]"] as const,
  captchaMarkers: ["[data-test=captcha]", "[data-test=verification-required]"] as const,
  loginText: ["登录后继续", "请先登录", "登录已过期"] as const,
  captchaText: ["安全验证", "验证码", "完成验证"] as const,
});

export type XhsEditorSelectors = typeof XHS_EDITOR_SELECTORS;
