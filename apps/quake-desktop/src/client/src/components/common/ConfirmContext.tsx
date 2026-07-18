import React, { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";

interface ConfirmState {
  props: ConfirmDialogProps;
  resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (props: Omit<ConfirmDialogProps, "onConfirm" | "onCancel">) => Promise<boolean>;
  confirmDanger: (title: string, message: string) => Promise<boolean>;
  confirmDelete: (itemName: string) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirmAction() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirmAction must be used within ConfirmProvider");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((props: Omit<ConfirmDialogProps, "onConfirm" | "onCancel">): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({
        props: {
          ...props,
          onConfirm: () => { setState(null); resolve(true); },
          onCancel: () => { setState(null); resolve(false); },
        },
        resolve,
      });
    });
  }, []);

  const confirmDanger = useCallback((title: string, message: string) => {
    return confirm({ title, message, variant: "danger", confirmLabel: "Sil" });
  }, [confirm]);

  const confirmDelete = useCallback((itemName: string) => {
    return confirm({
      title: "Silme onayı",
      message: `"${itemName}" kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      variant: "danger",
      confirmLabel: "Sil",
      requireText: "SİL",
    });
  }, [confirm]);

  return (
    <ConfirmContext.Provider value={{ confirm, confirmDanger, confirmDelete }}>
      {children}
      {state && <ConfirmDialog {...state.props} />}
    </ConfirmContext.Provider>
  );
}
