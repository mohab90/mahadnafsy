import { create } from 'zustand';
import { OrderItem, ExpenseItem, DiscountRule } from '../types';
import { mysqlAdmin } from '../lib/mysqlapi';

const logPersistError = (what: string) => (err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[useFinanceStore] failed to persist ${what}:`, err);
};

interface FinanceState {
  orders: OrderItem[];
  expenses: ExpenseItem[];
  discounts: DiscountRule[];

  setOrders: (orders: OrderItem[]) => void;
  setExpenses: (expenses: ExpenseItem[]) => void;
  setDiscounts: (discounts: DiscountRule[]) => void;

  addOrder: (item: OrderItem) => void;
  updateOrderStatus: (id: string, status: OrderItem['status']) => void;
  deleteOrder: (id: string) => void;

  addExpense: (item: ExpenseItem) => void;
  updateExpense: (item: ExpenseItem) => void;
  deleteExpense: (id: string) => void;

  addDiscount: (item: DiscountRule) => void;
  updateDiscount: (item: DiscountRule) => void;
  deleteDiscount: (id: string) => void;
}

export const useFinanceStore = create<FinanceState>((set) => ({
  orders: [],
  expenses: [],
  discounts: [],

  setOrders: (orders) => set({ orders }),
  setExpenses: (expenses) => set({ expenses }),
  setDiscounts: (discounts) => set({ discounts }),

  addOrder: (item) => {
    set((state) => ({ orders: [item, ...state.orders] }));
    void mysqlAdmin.saveOrder(item as unknown as Record<string, unknown>).catch(logPersistError('order'));
  },
  updateOrderStatus: (id, status) => {
    set((state) => ({ orders: state.orders.map((o) => (o.id === id ? { ...o, status } : o)) }));
    void mysqlAdmin.updateOrderStatus(id, status).catch(logPersistError('order status'));
  },
  deleteOrder: (id) => set((state) => ({ orders: state.orders.filter((o) => o.id !== id) })),

  addExpense: (item) => {
    set((state) => ({ expenses: [...state.expenses, item] }));
    void mysqlAdmin.saveExpense(item as unknown as Record<string, unknown>).catch(logPersistError('expense'));
  },
  updateExpense: (item) => {
    set((state) => ({ expenses: state.expenses.map((e) => (e.id === item.id ? item : e)) }));
    void mysqlAdmin.updateExpense(item as unknown as Record<string, unknown>).catch(logPersistError('expense'));
  },
  deleteExpense: (id) => set((state) => ({ expenses: state.expenses.filter((e) => e.id !== id) })),

  addDiscount: (item) => set((state) => {
    const discounts = [...state.discounts, item];
    void mysqlAdmin.saveDiscounts(discounts as unknown as Record<string, unknown>[]).catch(logPersistError('discount'));
    return { discounts };
  }),
  updateDiscount: (item) => set((state) => {
    const discounts = state.discounts.map((d) => (d.id === item.id ? item : d));
    void mysqlAdmin.saveDiscounts(discounts as unknown as Record<string, unknown>[]).catch(logPersistError('discount'));
    return { discounts };
  }),
  deleteDiscount: (id) => set((state) => {
    const discounts = state.discounts.filter((d) => d.id !== id);
    void mysqlAdmin.saveDiscounts(discounts as unknown as Record<string, unknown>[]).catch(logPersistError('discount'));
    return { discounts };
  }),
}));
