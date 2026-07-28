import { Menu, type MenuItemConstructorOptions } from "electron";
import type { NativeLocale } from "./native-locale";

const menuCopy = {
  tr: {
    file: "Dosya",
    openFolder: "Klasör Aç…",
    close: "Kapat",
    quit: "Çıkış",
    edit: "Düzenle",
    undo: "Geri Al",
    redo: "Yinele",
    cut: "Kes",
    copy: "Kopyala",
    paste: "Yapıştır",
    selectAll: "Tümünü Seç",
    view: "Görünüm",
    reload: "Yeniden Yükle",
    forceReload: "Zorla Yeniden Yükle",
    toggleDevTools: "Geliştirici Araçlarını Aç/Kapat",
    resetZoom: "Yakınlaştırmayı Sıfırla",
    zoomIn: "Yakınlaştır",
    zoomOut: "Uzaklaştır",
    toggleFullscreen: "Tam Ekrana Geç",
    window: "Pencere",
    minimize: "Simge Durumuna Küçült",
    zoom: "Yakınlaştır",
    bringAllToFront: "Tümünü Öne Getir",
  },
  en: {
    file: "File",
    openFolder: "Open Folder…",
    close: "Close",
    quit: "Quit",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    selectAll: "Select All",
    view: "View",
    reload: "Reload",
    forceReload: "Force Reload",
    toggleDevTools: "Toggle Developer Tools",
    resetZoom: "Reset Zoom",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    toggleFullscreen: "Toggle Full Screen",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    bringAllToFront: "Bring All to Front",
  },
} as const;

export function buildMenu(opts: { onOpenFolder: () => void }, locale: NativeLocale): Menu {
  const isMac = process.platform === "darwin";
  const copy = menuCopy[locale];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: "appMenu" }] as MenuItemConstructorOptions[]) : []),
    {
      label: copy.file,
      submenu: [
        { label: copy.openFolder, accelerator: "CmdOrCtrl+O", click: () => opts.onOpenFolder() },
        { type: "separator" },
        isMac ? { label: copy.close, role: "close" } : { label: copy.quit, role: "quit" },
      ],
    },
    {
      label: copy.edit,
      submenu: [
        { label: copy.undo, role: "undo" },
        { label: copy.redo, role: "redo" },
        { type: "separator" },
        { label: copy.cut, role: "cut" },
        { label: copy.copy, role: "copy" },
        { label: copy.paste, role: "paste" },
        { label: copy.selectAll, role: "selectAll" },
      ],
    },
    {
      label: copy.view,
      submenu: [
        { label: copy.reload, role: "reload" },
        { label: copy.forceReload, role: "forceReload" },
        { label: copy.toggleDevTools, role: "toggleDevTools" },
        { type: "separator" },
        { label: copy.resetZoom, role: "resetZoom" },
        { label: copy.zoomIn, role: "zoomIn" },
        { label: copy.zoomOut, role: "zoomOut" },
        { type: "separator" },
        { label: copy.toggleFullscreen, role: "togglefullscreen" },
      ],
    },
    {
      label: copy.window,
      submenu: [
        { label: copy.minimize, role: "minimize" },
        ...(isMac ? ([{ label: copy.zoom, role: "zoom" }, { type: "separator" }, { label: copy.bringAllToFront, role: "front" }] as MenuItemConstructorOptions[]) : []),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
