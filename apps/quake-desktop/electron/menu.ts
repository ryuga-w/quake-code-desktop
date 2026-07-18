import { Menu, type MenuItemConstructorOptions } from "electron";

export function buildMenu(opts: { onOpenFolder: () => void }): Menu {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: "appMenu" }] as MenuItemConstructorOptions[]) : []),
    {
      label: "Dosya",
      submenu: [
        { label: "Klasör Aç…", accelerator: "CmdOrCtrl+O", click: () => opts.onOpenFolder() },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}
