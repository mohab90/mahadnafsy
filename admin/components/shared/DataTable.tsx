import React, { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string | ReactNode;
  render?: (item: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  loading?: boolean;
  total?: number;
  offset?: number;
  limit?: number;
  onPageChange?: (offset: number) => void;
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
  actions?: (item: T) => ReactNode;
}

export function DataTable<T extends { id?: string | number }>({
  data,
  columns,
  loading = false,
  total = 0,
  offset = 0,
  limit = 25,
  onPageChange,
  onSearch,
  searchPlaceholder = 'بحث...',
  actions,
}: DataTableProps<T>) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      {onSearch && (
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3">
          <input
            type="search"
            placeholder={searchPlaceholder}
            className="w-64 max-w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-indigo-500"
            onChange={(event) => onSearch(event.target.value)}
          />
          <div className="text-xs font-medium text-gray-500">
            اجمالي السجلات: <span className="font-bold text-gray-900">{total}</span>
          </div>
        </div>
      )}

      <div className="min-h-[300px] overflow-x-auto">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-indigo-600">
            <span className="h-8 w-8 rounded-full border-4 border-current border-t-transparent animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="p-12 text-center text-sm font-medium text-gray-500">لا توجد بيانات للعرض</div>
        ) : (
          <table className="w-full text-right text-sm">
            <thead className="border-b border-gray-200 bg-gray-100 text-xs font-bold text-gray-700">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className={`p-3 whitespace-nowrap ${column.className || ''}`}>
                    {column.header}
                  </th>
                ))}
                {actions && <th className="w-32 p-3 text-center">اجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((item, index) => (
                <tr key={item.id || index} className="transition hover:bg-indigo-50/30">
                  {columns.map((column) => (
                    <td key={column.key} className={`p-3 align-top ${column.className || ''}`}>
                      {column.render ? column.render(item) : (item as Record<string, ReactNode>)[column.key]}
                    </td>
                  ))}
                  {actions && <td className="p-3 text-center">{actions(item)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {onPageChange && total > limit && (
        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            السابق
          </button>
          <span className="text-xs font-medium text-gray-600">
            صفحة {Math.floor(offset / limit) + 1} من {Math.ceil(total / limit)}
          </span>
          <button
            type="button"
            disabled={offset + limit >= total}
            onClick={() => onPageChange(offset + limit)}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            التالي
          </button>
        </div>
      )}
    </div>
  );
}
