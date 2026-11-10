export type Dim = 'query' | 'page' | 'country' | 'device'
export const DIMS: Dim[] = ['query', 'page', 'country', 'device']

/**
 * One row of Search Console data at some grain. `g` is the grain: the dimensions present, joined by "|"
 * ("" for daily site totals, "query|page" for API rows). Rows carry either a date (API, Dates table)
 * or a period tag (an undated UI export, where "prev" comes from compare-mode columns).
 */
export interface Fact {
  g: string
  date?: string
  period?: 'cur' | 'prev'
  query?: string
  page?: string
  country?: string
  device?: string
  clicks: number
  impressions: number
  position: number
}

export interface Agg {
  key: string
  dims: Partial<Record<Dim, string>>
  clicks: number
  impressions: number
  /** Sum of position x impressions, so positions average correctly when rolled up. */
  posSum: number
}

export const pos = (a: Pick<Agg, 'posSum' | 'impressions'>) => a.impressions ? a.posSum / a.impressions : NaN
export const ctr = (a: Pick<Agg, 'clicks' | 'impressions'>) => a.impressions ? a.clicks / a.impressions : 0

export interface Settings {
  brandTerms: string[]
  /** URL path depth used to group pages, 1 = /blog/ */
  groupDepth: number
  /** Months of history used for content decay */
  decayMonths: number
  /** Ignore queries or pages with fewer impressions per month than this */
  minImpressions: number
}

export const DEFAULT_SETTINGS: Settings = { brandTerms: [], groupDepth: 1, decayMonths: 6, minImpressions: 30 }
