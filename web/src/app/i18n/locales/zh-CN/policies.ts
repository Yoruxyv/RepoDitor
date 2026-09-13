import type { TranslationShape } from "@/app/i18n/types";
import { policiesEn } from "@/app/i18n/locales/en/policies";

export const policiesZhCn: TranslationShape<typeof policiesEn> = {
  licenseTitle: "许可证",
  privacyTitle: "数据与隐私",
  privacyOne: "存档内容在本地处理，RepoDitor Web 不会持久化保存。",
  privacyTwo:
    "存档文件和解密后的 JSON 不会上传。可选的 Steam 头像补充仅向 RepoDitor 同源端点发送已验证的 Steam ID。主题和语言偏好保存在本地；存档数据不会使用该存储空间。",
  securityTitle: "安全",
  securityOne:
    "RepoDitor 会验证受支持的存档结构，在内存中暂存更改，并在下载前验证每个加密导出文件。",
  securityBeforeLink: "请通过仓库的",
  securityLink: "安全公告表单",
  securityAfterLink: "私下报告漏洞。请勿在公开报告中包含真实存档或解密数据。",
  termsTitle: "条款",
  termsOne: "RepoDitor 是独立的社区工具，与 semiwork 没有关联。",
  termsTwo: "请使用存档副本并在导出前检查更改。备份和下载文件的使用由您自行负责。",
};
