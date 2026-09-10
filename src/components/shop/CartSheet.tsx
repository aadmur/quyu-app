import { AnimatePresence, m } from "framer-motion";
import { Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

function formatPrice(n: number): string {
  return `¥${n}`;
}

export interface CartItemView {
  productId: number;
  name: string;
  price: number;
  image: string;
  qty: number;
}

interface CartSheetProps {
  open: boolean;
  items: CartItemView[];
  ordering: boolean;
  onClose: () => void;
  onSetQty: (productId: number, qty: number) => void;
  onCheckout: () => void;
}

/** 购物车抽屉：真实数据，支持改数量与结算 */
export default function CartSheet({ open, items, ordering, onClose, onSetQty, onCheckout }: CartSheetProps) {
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.button
            type="button" aria-label="关闭购物车"
            className="fixed inset-0 z-40 bg-ink/35 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <m.aside
            role="dialog" aria-label="购物车"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-3xl bg-white px-5 pt-3 shadow-float"
            style={{ paddingBottom: "max(var(--safe-bottom, 0px), 32px)" }}
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
            <header className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-ink">
                <ShoppingCart size={16} className="text-brand-500" /> 购物车
                <span className="text-[12px] font-semibold text-slate-400">{items.length} 件</span>
              </h3>
              <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 active:bg-slate-100">
                <X size={17} />
              </button>
            </header>

            <ul className="max-h-[46vh] space-y-3 overflow-y-auto no-scrollbar">
              {items.length === 0 && (
                <li className="py-10 text-center text-[13px] text-slate-400">购物车还是空的，去挑点装备吧</li>
              )}
              {items.map((it) => (
                <li key={it.productId} className="flex items-center gap-3">
                  <img src={it.image} alt={it.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{it.name}</p>
                    <p className="price-font mt-0.5 text-[14px] font-bold text-brand-600">{formatPrice(it.price)}</p>
                  </div>
                  <div className="flex items-center gap-2.5 rounded-full bg-slate-100 px-2 py-1">
                    <button type="button" aria-label="减少数量"
                      onClick={() => onSetQty(it.productId, it.qty - 1)}
                      className="grid h-6 w-6 place-items-center rounded-full bg-white text-slate-600 shadow-xs active:scale-90">
                      {it.qty <= 1 ? <Trash2 size={12} /> : <Minus size={12} />}
                    </button>
                    <span className="w-4 text-center text-[13px] font-bold tabular-nums text-ink">{it.qty}</span>
                    <button type="button" aria-label="增加数量"
                      onClick={() => onSetQty(it.productId, it.qty + 1)}
                      className="grid h-6 w-6 place-items-center rounded-full bg-white text-slate-600 shadow-xs active:scale-90">
                      <Plus size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
              <p className="flex-1 text-[13px] text-slate-500">
                合计{" "}
                <span className="price-font text-[19px] font-extrabold text-ink">{formatPrice(total)}</span>
              </p>
              <m.button
                type="button" whileTap={{ scale: 0.95 }} onClick={onCheckout}
                disabled={items.length === 0 || ordering}
                className={cn(
                  "rounded-full px-6 py-3 text-[14px] font-bold text-white transition",
                  items.length === 0 || ordering ? "bg-slate-300" : "bg-gradient-to-r from-brand-600 to-brand-400 shadow-glow active:brightness-95",
                )}
              >
                {ordering ? "下单中…" : "去结算"}
              </m.button>
            </div>
          </m.aside>
        </>
      )}
    </AnimatePresence>
  );
}
