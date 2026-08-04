import * as XLSX from 'xlsx'
import type { ParseResult } from '../types'
import { parseRows } from './parser'

/**
 * Reads the first sheet of a workbook (or CSV) and delegates to parseRows.
 *
 * This is the ONLY module that imports `xlsx`, which is ~600 kB minified. It is
 * kept separate from parser.ts — and loaded with a dynamic import from the upload
 * modal — so a user who never imports a file never downloads a spreadsheet
 * parser. Keep the pure row logic in parser.ts free of this dependency.
 */
export function parseSheet(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('The file contains no sheets.')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: '',
  })
  return parseRows(rows)
}
