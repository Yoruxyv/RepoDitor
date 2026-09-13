import type { TranslationShape } from "@/app/i18n/types";
import { policiesEn } from "@/app/i18n/locales/en/policies";

export const policiesId: TranslationShape<typeof policiesEn> = {
  licenseTitle: "Lisensi",
  privacyTitle: "Data & Privasi",
  privacyOne: "Isi save diproses secara lokal dan tidak disimpan oleh RepoDitor Web.",
  privacyTwo:
    "File save dan JSON yang didekripsi tidak diunggah. Pengayaan avatar Steam opsional hanya mengirim Steam ID tervalidasi ke endpoint RepoDitor pada origin yang sama. Preferensi tema dan bahasa disimpan secara lokal; data save tidak pernah memakai penyimpanan tersebut.",
  securityTitle: "Keamanan",
  securityOne:
    "RepoDitor memvalidasi struktur save yang didukung, menyiapkan perubahan di memori, dan memverifikasi setiap ekspor terenkripsi sebelum diunduh.",
  securityBeforeLink: "Laporkan kerentanan secara privat melalui",
  securityLink: "formulir advisori keamanan",
  securityAfterLink: ". Jangan sertakan file save asli atau data terdekripsi dalam laporan publik.",
  termsTitle: "Ketentuan",
  termsOne: "RepoDitor adalah alat komunitas independen dan tidak berafiliasi dengan semiwork.",
  termsTwo:
    "Gunakan salinan save dan tinjau perubahan sebelum ekspor. Anda bertanggung jawab atas cadangan dan penggunaan file yang diunduh.",
};
