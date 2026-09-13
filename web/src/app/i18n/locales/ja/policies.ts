import type { TranslationShape } from "@/app/i18n/types";
import { policiesEn } from "@/app/i18n/locales/en/policies";

export const policiesJa: TranslationShape<typeof policiesEn> = {
  licenseTitle: "ライセンス",
  privacyTitle: "データとプライバシー",
  privacyOne: "セーブ内容はローカルで処理され、RepoDitor Web に保存されません。",
  privacyTwo:
    "セーブファイルと復号済み JSON はアップロードされません。任意の Steam アバター取得では、検証済み Steam ID のみを同一オリジンの RepoDitor エンドポイントへ送信します。テーマと言語設定はローカルに保存されますが、セーブデータはその領域を使用しません。",
  securityTitle: "セキュリティ",
  securityOne:
    "RepoDitor は対応するセーブ構造を検証し、変更をメモリ上に保持し、暗号化した各エクスポートをダウンロード前に検証します。",
  securityBeforeLink: "脆弱性はリポジトリの",
  securityLink: "セキュリティアドバイザリフォーム",
  securityAfterLink:
    "から非公開で報告してください。実際のセーブや復号済みデータを公開報告に含めないでください。",
  termsTitle: "利用条件",
  termsOne: "RepoDitor は独立したコミュニティツールで、semiwork とは関係ありません。",
  termsTwo:
    "セーブのコピーを使い、エクスポート前に変更を確認してください。バックアップとダウンロードしたファイルの使用は利用者の責任です。",
};
