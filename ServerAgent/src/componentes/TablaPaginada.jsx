import React, { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function TablaPaginada({
  rows = [],
  columns = [],
  renderRow,
  rowKey,
  pageSizeDefault = 10,
  pageSizeOptions = [10, 25, 50, 100],
  emptyText,
  className = ''
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(pageSizeDefault)
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    setPage((actual) => Math.min(Math.max(1, actual), totalPages))
  }, [totalPages])

  useEffect(() => { setPage(1) }, [pageSize, total])

  const visibles = useMemo(() => {
    const inicio = (page - 1) * pageSize
    return rows.slice(inicio, inicio + pageSize)
  }, [rows, page, pageSize])

  const desde = total ? (page - 1) * pageSize + 1 : 0
  const hasta = Math.min(page * pageSize, total)
  const colspan = Math.max(1, columns.length)

  return <div className={`data-table-shell ${className}`}>
    <div className="data-table-wrap">
      <table className="data-table">
        <thead><tr>{columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
        <tbody>
          {visibles.length ? visibles.map((row, index) => renderRow(row, index, { page, pageSize })) : <tr><td colSpan={colspan} className="table-empty">{emptyText || t('tabla.sinRegistros')}</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="table-pagination">
      <div className="table-page-size">
        <span>{t('tabla.mostrar')}</span>
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <span>{t('tabla.registros')}</span>
      </div>
      <strong>{t('tabla.mostrando')} {desde}-{hasta} {t('tabla.de')} {total}</strong>
      <div className="table-page-actions">
        <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft size={15}/>{t('tabla.anterior')}</button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>{t('tabla.siguiente')}<ChevronRight size={15}/></button>
      </div>
    </div>
  </div>
}
