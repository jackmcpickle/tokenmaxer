import { createFileRoute } from '@tanstack/react-router'
import {
  parseCountryParam,
  parseSourceParam,
  parseWindow,
} from '@/api/leaderboard'
import {
  parseImpactMetric,
  parseImpactRegion,
  parseImpactScenario,
} from '@/lib/impact'
import { getFootprintPageData } from '@/core/api/board.api'
import { getBaseUrl } from '@/core/api/site.api'
import { Footprint } from '@/pages/footprint'
import type {
  ImpactMetric,
  ImpactRegion,
  ImpactScenario,
} from '@/lib/impact'
import type { Source, TimeWindow } from '@/types'

interface FootprintSearch {
  window: TimeWindow
  metric: ImpactMetric
  scenario: ImpactScenario
  region: ImpactRegion
  source: Source | undefined
  model: string | undefined
  country: string | undefined
}

function parseFootprintSearch(search: Record<string, unknown>): FootprintSearch {
  const modelRaw = search.model
  const model =
    typeof modelRaw === 'string' && modelRaw.length > 0 ? modelRaw : undefined
  return {
    window: parseWindow(
      typeof search.window === 'string' ? search.window : undefined,
    ),
    metric: parseImpactMetric(
      typeof search.metric === 'string' ? search.metric : undefined,
    ),
    scenario: parseImpactScenario(
      typeof search.scenario === 'string' ? search.scenario : undefined,
    ),
    region: parseImpactRegion(
      typeof search.region === 'string' ? search.region : undefined,
    ),
    source: parseSourceParam(
      typeof search.source === 'string' ? search.source : undefined,
    ),
    model,
    country: parseCountryParam(
      typeof search.country === 'string' ? search.country : undefined,
    ),
  }
}

export const Route = createFileRoute('/footprint')({
  head: () => ({
    meta: [{ title: 'Footprint · tokenmaxer.quest' }],
  }),
  validateSearch: parseFootprintSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [base, board] = await Promise.all([
      getBaseUrl(),
      getFootprintPageData({ data: deps }),
    ])
    return { base, ...board, ...deps }
  },
  component: FootprintPage,
})

function FootprintPage() {
  const data = Route.useLoaderData()
  return (
    <Footprint
      base={data.base}
      entries={data.entries}
      models={data.models}
      countries={data.countries}
      window={data.window}
      metric={data.metric}
      scenario={data.scenario}
      region={data.region}
      source={data.source}
      model={data.model}
      country={data.country}
    />
  )
}
