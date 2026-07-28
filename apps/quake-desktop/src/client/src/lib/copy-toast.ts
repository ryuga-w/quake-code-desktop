import { useAppStore } from "../state/app-store";

export function copyTextWithToast(text: string, successMessage = "Kopyalandı") {
  const showToast = useAppStore.getState().showToast;
  if (!text) {
    showToast("Kopyalanacak içerik yok", "warning");
    return;
  }
  if (!navigator.clipboard?.writeText) {
    showToast("Kopyalama desteklenmiyor", "error");
    return;
  }
  void navigator.clipboard.writeText(text)
    .then(() => showToast(successMessage, "success"))
    .catch((error: any) => showToast(`Kopyalama başarısız: ${error?.message || "bilinmeyen hata"}`, "error"));
}
